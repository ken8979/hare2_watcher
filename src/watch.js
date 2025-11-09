import { config, buildCollectionUrl } from './config.js';
import { fetchCollectionPage, detectMaxPage } from './collection.js';
import { fetchProductJsonByUrl, isTargetProduct } from './product.js';
import { dedupeCheckAndSet, getProductState, setProductState } from './redis.js';
import { sendSlack } from './slack.js';
import { sendEmail } from './email.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function jitteredDelay(baseMs) {
  const j = Math.floor(Math.random() * (config.jitterMsMax - config.jitterMsMin + 1)) + config.jitterMsMin;
  return baseMs + j;
}

function eventId(product, eventType) {
  const identity = product.handle || product.productId || product.url;
  return `${eventType}::${identity}::${product.totalStock}`;
}

async function handleProduct(product) {
  // 新規高額カードページ検知: #数字4桁を含む商品は、hashNumberをidentityに含める
  const hashNumber = product.hashNumber;
  let identity = product.handle || product.productId || product.url;
  if (hashNumber) {
    // 同じカードの別ページ（#1384 vs #1415）を区別するため、hashNumberを含める
    identity = `${product.handle || product.productId}::#${hashNumber}`;
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
    // 初回検知
    notify = true;
    // 新規高額カードページ検知: タイトルに#数字4桁がある場合は特別なイベントタイプ
    if (hashNumber) {
      eventType = 'NewHighPricePage';
    }
  } else if (hashNumber && prevHashNumber !== hashNumber) {
    // 新規高額カードページ検知: #数字4桁が変わった場合
    notify = true;
    eventType = 'NewHighPricePage';
  } else if (prevPrice !== null && prevPrice !== product.priceYen) {
    // 価格変動
    notify = true;
    eventType = 'PriceChanged';
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
      const msgParts = [
        `【${eventType}】¥${product.priceYen.toLocaleString()} 在庫${product.totalStock}`,
        product.title,
        product.url,
        prevStock !== null ? `前回在庫: ${prevStock}` : '前回在庫: N/A',
      ];
      
      if (prevPrice !== null && prevPrice !== product.priceYen) {
        const priceDelta = product.priceYen - prevPrice;
        const deltaStr = priceDelta > 0 ? `+¥${priceDelta.toLocaleString()}` : `¥${priceDelta.toLocaleString()}`;
        msgParts.push(`前回価格: ¥${prevPrice.toLocaleString()} → ${deltaStr}`);
      }
      
      const message = msgParts.join('\n');
      await sendSlack(message);
      
      // メール通知も送信（設定で有効/無効を切り替え可能）
      if (config.emailEnabled) {
        try {
          await sendEmail(`【${eventType}】${product.title}`, message);
        } catch (err) {
          console.warn('[watch] メール送信失敗:', err.message);
        }
      }
    }
  }

  await setProductState(identity, {
    lastTotalStock: product.totalStock,
    lastEventType: notify ? eventType : (prev?.lastEventType ?? ''),
    lastEventAt: notify ? now : (prev?.lastEventAt ?? ''),
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastPriceYen: product.priceYen,
    lastHashNumber: hashNumber || '',
  });
}

async function processPage(collectionBase, page, isHotPage = false) {
  const { changed, links, url } = await fetchCollectionPage(collectionBase, page);
  // バグ修正: page1は常に商品JSON取得（ハッシュ変化に関係なく）
  if (!changed && !isHotPage) {
    return; // page1以外で変化がない場合はスキップ
  }
  
  // 対象商品のJSONを並列取得
  const concurrency = 4;
  const queue = [...links];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const productUrl = queue.shift();
      try {
        const p = await fetchProductJsonByUrl(productUrl);
        if (isTargetProduct(p)) {
          await handleProduct(p);
        }
      } catch (e) {
        console.warn('[product]', productUrl, e.message);
      }
      // レートを守る
      await sleep(jitteredDelay(1000 / Math.max(config.rpsBudget, 0.1)));
    }
  });
  await Promise.all(workers);
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

async function mainLoop() {
  console.log('[watch] start');
  console.log(`[watch] 監視コレクション数: ${config.collections.length}`);
  
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
            await processPage(collection.base, page, isHot);
          } catch (e) {
            console.warn(`[watch] ${collection.name} page${page} エラー:`, e.message);
          }
        }
        
        lastRunTimes.set(collectionKey, now);
        console.log(`[watch] 処理完了: ${collection.name}`);
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

