import { config, buildCollectionUrl } from './config.js';
import { fetchCollectionPage, detectMaxPage } from './collection.js';
import { fetchProductJsonByUrl, isTargetProduct } from './product.js';
import { dedupeCheckAndSet, getProductState, setProductState } from './redis.js';
import { sendSlack } from './slack.js';
import { sendEmail, sendBatchEmail } from './email.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function jitteredDelay(baseMs) {
  const j = Math.floor(Math.random() * (config.jitterMsMax - config.jitterMsMin + 1)) + config.jitterMsMin;
  return baseMs + j;
}

function eventId(product, eventType) {
  const identity = product.handle || product.productId || product.url;
  return `${eventType}::${identity}::${product.totalStock}`;
}

// メール通知キュー（コレクション名をキーとして管理）
const emailNotificationQueue = new Map();

async function handleProduct(product, collectionName) {
  // 新規高額カードページ検知: #数字4桁を含む商品は、hashNumberをidentityに含める
  const hashNumber = product.hashNumber;
  
  // identityを生成（handle > productId > URLから抽出）
  let identity = product.handle || product.productId;
  
  // handle/productIdが取得できない場合は、URLから抽出
  if (!identity && product.url) {
    try {
      const urlObj = new URL(product.url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2 && pathParts[0] === 'products') {
        identity = pathParts[1]; // /products/handle から handle を取得
      } else {
        identity = product.url; // フォールバック
      }
    } catch {
      identity = product.url; // フォールバック
    }
  }
  
  if (hashNumber) {
    // 同じカードの別ページ（#1384 vs #1415）を区別するため、hashNumberを含める
    identity = `${identity}::#${hashNumber}`;
  }
  
  // identityが空の場合はスキップ
  if (!identity) {
    console.warn(`[watch] identityが空のためスキップ: ${product.title}`);
    return;
  }
  
  const prev = await getProductState(identity);
  const prevHashNumber = prev?.lastHashNumber || null;
  const prevStock = prev?.lastTotalStock ?? null;
  const prevPrice = prev?.lastPriceYen ?? null;
  const now = new Date().toISOString();

  // イベント判定（価格変動も含む）
  // バグ修正: 在庫増加の誤検知対策 - delta >= 1を明示的にチェック
  let notify = false;
  let eventType = 'HighPriceInStock';
  
  if (prevStock === null) {
    // 初回検知（初回検知は通知しない - 在庫変動のみ通知）
    // 初回検知の商品は状態を保存するだけで、通知はしない
    // これにより、毎回初回検知として通知されることを防ぐ
    notify = false;
    eventType = 'HighPriceInStock';
    // 新規高額カードページ検知: タイトルに#数字4桁がある場合は特別なイベントタイプ
    if (hashNumber) {
      eventType = 'NewHighPricePage';
      // NewHighPricePageの場合は通知する
      notify = true;
    }
  } else if (hashNumber && prevHashNumber !== hashNumber) {
    // 新規高額カードページ検知: #数字4桁が変わった場合
    notify = true;
    eventType = 'NewHighPricePage';
  } else if (prevPrice !== null && prevPrice !== product.priceYen) {
    // 価格変動（通知しない - 在庫変更のみ通知）
    // notify = false; // 価格変更は通知しない
  } else if (prevStock === 0 && product.totalStock > 0) {
    // 再入荷（在庫0→1以上）
    notify = true;
    eventType = 'BackInStock';
  } else if (prevStock !== null && product.totalStock > prevStock) {
    // 在庫増加（バグ修正: delta >= 1を明示的にチェック）
    const delta = product.totalStock - prevStock;
    if (delta >= 1) {
      notify = true;
      eventType = 'StockIncreased';
    } else {
      // delta < 1の場合は通知しない（誤検知防止）
      console.log(`[watch] 在庫変動が1未満のため通知スキップ: ${identity} ${prevStock} → ${product.totalStock} (delta=${delta})`);
    }
  } else if (config.notifySoldOut && prevStock !== null && prevStock > 0 && product.totalStock === 0) {
    // 売り切れ通知（設定で有効/無効を切り替え可能）
    notify = true;
    eventType = 'SoldOut';
  } else if (config.notifyStockDecrease && prevStock !== null && prevStock > product.totalStock && product.totalStock > 0) {
    // 在庫減少通知（設定で有効/無効を切り替え可能）
    notify = true;
    eventType = 'StockDecreased';
  }

  if (notify) {
    // バグ修正: 在庫数が変わった場合は新しいeventIdを生成（重複防止キーの見直し）
    // 在庫数と価格を含めてeventIdを生成することで、同じ商品でも在庫/価格が変わった場合は通知
    const stockKey = prevStock !== null ? `${prevStock}->${product.totalStock}` : `null->${product.totalStock}`;
    const priceKey = prevPrice !== null ? `${prevPrice}->${product.priceYen}` : `null->${product.priceYen}`;
    const eid = `${eventType}::${identity}::${stockKey}::${priceKey}`;
    const first = await dedupeCheckAndSet(eid, config.dedupeCooldownSec);
    if (first) {
      console.log(`[watch] 通知送信: ${eventType} ${identity} 在庫${prevStock ?? 'N/A'}→${product.totalStock}`);
      // 商品名から余分なスペースや改行を削除
      const cleanTitle = (product.title || '').replace(/\s+/g, ' ').trim();
      const msgParts = [];
      
      // 【HighPriceInStock】の行は追加しない
      if (eventType !== 'HighPriceInStock') {
        msgParts.push(`【${eventType}】¥${product.priceYen.toLocaleString()} 在庫${product.totalStock}`);
      }
      
      msgParts.push(cleanTitle);
      msgParts.push(product.url);
      if (prevStock !== null) {
        msgParts.push(`在庫: ${prevStock} → ${product.totalStock}`);
      } else {
        msgParts.push(`在庫: N/A → ${product.totalStock}`);
      }
      
      // 価格変更の情報は追加しない（価格変更通知自体が無効化されているため、この部分は実行されないが念のため）
      // if (prevPrice !== null && prevPrice !== product.priceYen) {
      //   const priceDelta = product.priceYen - prevPrice;
      //   const deltaStr = priceDelta > 0 ? `+¥${priceDelta.toLocaleString()}` : `¥${priceDelta.toLocaleString()}`;
      //   msgParts.push(`前回価格: ¥${prevPrice.toLocaleString()} → ${deltaStr}`);
      // }
      
      const message = msgParts.join('\n');
      await sendSlack(message);
      
      // メール通知処理
      if (config.emailEnabled) {
        // collectionNameが未指定の場合は、URLから推測を試みる
        let queueKey = collectionName;
        if (!queueKey && product.url) {
          // URLからコレクション名を推測（例: /collections/pmcg/ から pmcg）
          const urlMatch = product.url.match(/\/collections\/([^\/]+)/);
          if (urlMatch) {
            queueKey = urlMatch[1].toUpperCase();
          } else {
            queueKey = 'UNKNOWN';
          }
        }
        
        if (queueKey) {
          // NewHighPricePageの場合は即座にメールを送信
          if (eventType === 'NewHighPricePage') {
            console.log(`[watch] NewHighPricePageを即時メール送信: ${queueKey}`);
            try {
              await sendBatchEmail(queueKey, [{
                eventType,
                message,
                product,
                timestamp: new Date().toISOString(),
              }]);
            } catch (error) {
              console.error(`[watch] 即時メール送信失敗: ${queueKey}`, error.message);
            }
          } else {
            // その他のイベントはキューに追加（コレクション処理完了後にバッチ送信）
            if (!emailNotificationQueue.has(queueKey)) {
              emailNotificationQueue.set(queueKey, []);
            }
            emailNotificationQueue.get(queueKey).push({
              eventType,
              message,
              product,
              timestamp: new Date().toISOString(),
            });
            const queueSize = emailNotificationQueue.get(queueKey).length;
            console.log(`[watch] メール通知をキューに追加: ${queueKey} (キューサイズ: ${queueSize})`);
          }
        } else {
          console.warn('[watch] メール通知キューに追加失敗: collectionNameが不明');
        }
      }
    }
  }

  // 状態を保存（通知の有無に関わらず、常に保存）
  // これにより、次回のチェック時に正しい前回状態が取得できる
  try {
    await setProductState(identity, {
      lastTotalStock: product.totalStock,
      lastEventType: notify ? eventType : (prev?.lastEventType ?? ''),
      lastEventAt: notify ? now : (prev?.lastEventAt ?? ''),
      firstSeenAt: prev?.firstSeenAt ?? now,
      lastPriceYen: product.priceYen,
      lastHashNumber: hashNumber || '',
    });
    if (prevStock === null) {
      console.log(`[watch] 初回検知: ${identity} 在庫${product.totalStock} - 状態を保存（通知なし）`);
    }
  } catch (error) {
    console.error(`[watch] Redis状態保存失敗: ${identity}`, error.message);
    // エラーが発生しても処理を続行（通知は送信されるが、次回の重複防止に影響）
  }
}

async function processPage(collectionBase, page, isHotPage = false, collectionName = null) {
  const { changed, products, url } = await fetchCollectionPage(collectionBase, page);
  // バグ修正: page1は常に商品情報を処理（ハッシュ変化に関係なく）
  if (!changed && !isHotPage) {
    return; // page1以外で変化がない場合はスキップ
  }
  
  // 一覧ページから取得した商品情報を処理
  console.log(`[watch] ${collectionName || 'unknown'} page${page}: ${products.length}件の商品を処理`);
  
  for (const product of products) {
    try {
      if (isTargetProduct(product)) {
        await handleProduct(product, collectionName);
      }
    } catch (e) {
      console.warn('[product]', product.url, e.message);
    }
  }
}

// 優先度に応じた間隔を取得
function getIntervalForPriority(priority) {
  switch (priority) {
    case 'hot':
      return config.hotIntervalSec * 1000;
    case 'normal':
      return config.warmIntervalSec * 1000;
    case 'cold':
      return config.coldIntervalSec * 1000;
    default:
      return config.warmIntervalSec * 1000;
  }
}

// ページがホットページかどうか判定（page1-3はホット）
function isHotPage(pageNum) {
  return pageNum <= 3;
}

// バッチメール送信処理
async function processEmailBatch() {
  if (!config.emailEnabled) {
    return;
  }

  let totalSent = 0;
  for (const [collectionName, notifications] of emailNotificationQueue.entries()) {
    if (notifications.length > 0) {
      // キューから通知を取得して送信
      const batch = [...notifications];
      emailNotificationQueue.set(collectionName, []); // キューをクリア
      
      console.log(`[email] バッチメール送信開始: ${collectionName} (${batch.length}件)`);
      await sendBatchEmail(collectionName, batch);
      totalSent += batch.length;
    }
  }
  
  if (totalSent > 0) {
    console.log(`[email] バッチメール送信完了: 合計${totalSent}件`);
  }
}

async function mainLoop() {
  console.log('[watch] start');
  console.log(`[watch] 監視コレクション数: ${config.collections.length}`);
  
  // コレクション一覧をログに出力（デバッグ用）
  config.collections.forEach((col, index) => {
    console.log(`[watch]   ${index + 1}. ${col.name} (優先度: ${col.priority}, ページ: ${Array.isArray(col.pages) ? col.pages.length + 'ページ' : col.pages})`);
  });
  
  // 動的ページ数検出
  const resolvedCollections = [];
  for (const col of config.collections) {
    let pages = col.pages;
    if (col.autoDetectPages) {
      console.log(`[watch] ${col.name} の最大ページ数を検出中...`);
      const maxPage = await detectMaxPage(col.base);
      if (maxPage) {
        pages = Array.from({ length: maxPage }, (_, i) => i + 1);
        console.log(`[watch] ${col.name} 最大ページ数: ${maxPage}`);
      } else {
        console.warn(`[watch] ${col.name} の最大ページ数検出失敗、デフォルトページ数を使用`);
        pages = [1, 2, 3];
      }
    }
    
    resolvedCollections.push({
      ...col,
      pages: pages,
    });
    console.log(`[watch]   - ${col.name}: ${pages.length}ページ (優先度: ${col.priority})`);
  }
  
  // コレクションごとの最終実行時刻を管理
  const lastRunTimes = new Map();
  
  while (true) {
    const now = Date.now();
    
    // 各コレクションを処理
    for (const collection of resolvedCollections) {
      const collectionKey = collection.name;
      const lastRun = lastRunTimes.get(collectionKey) || 0;
      const interval = getIntervalForPriority(collection.priority);
      
      // 間隔が経過している場合のみ処理
      if (now - lastRun >= interval) {
        console.log(`[watch] 処理開始: ${collection.name}`);
        
        for (const page of collection.pages) {
          try {
            const isHot = isHotPage(page);
            await processPage(collection.base, page, isHot, collection.name);
          } catch (e) {
            console.warn(`[watch] ${collection.name} page${page} エラー:`, e.message);
          }
        }

        lastRunTimes.set(collectionKey, now);
        console.log(`[watch] 処理完了: ${collection.name}`);
        
        // コレクション処理完了後に、そのコレクションのバッチメールを送信
        if (config.emailEnabled) {
          const collectionNotifications = emailNotificationQueue.get(collection.name);
          if (collectionNotifications && collectionNotifications.length > 0) {
            console.log(`[watch] ${collection.name} のバッチメール送信開始 (${collectionNotifications.length}件)`);
            const batch = [...collectionNotifications];
            emailNotificationQueue.set(collection.name, []); // キューをクリア
            
            try {
              await sendBatchEmail(collection.name, batch);
              console.log(`[watch] ${collection.name} のバッチメール送信完了`);
            } catch (error) {
              console.error(`[watch] ${collection.name} のバッチメール送信失敗:`, error.message);
            }
          }
        }
      }
    }
    
    // 短い間隔でチェック（最小間隔の1/10）
    const minInterval = Math.min(...config.collections.map(c => getIntervalForPriority(c.priority)));
    await sleep(Math.max(1000, minInterval / 10));
  }
}

mainLoop().catch(err => {
  console.error(err);
  process.exit(1);
});

