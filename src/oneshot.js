import { config } from './config.js';
import { fetchCollectionPage } from './collection.js';
import { fetchProductJsonByUrl, isTargetProduct } from './product.js';
import { dedupeCheckAndSet, getProductState, setProductState } from './redis.js';
import { sendSlack } from './slack.js';
import { sendEmail } from './email.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fmtYen(n) { return `¥${Number(n).toLocaleString()}`; }

// ページネーションから最大ページ数を検出
async function detectMaxPage(collectionBase) {
  try {
    const { links: firstPageLinks } = await fetchCollectionPage(collectionBase, 1);
    // ページネーションリンクから最大ページ数を探す
    // 実際の実装では、HTMLをパースして「次」「最後」リンクから検出する必要がある
    // ここでは簡易的に、環境変数で指定されたページ数を使用
    return null; // 未実装の場合はnullを返す
  } catch {
    return null;
  }
}

async function main() {
  console.log('[oneshot] コレクション数:', config.collections.length, 'threshold=', config.priceThresholdYen);
  const found = [];
  
  for (const collection of config.collections) {
    console.log(`[oneshot] コレクション: ${collection.name} (${collection.pages.length}ページ)`);
    
    for (const page of collection.pages) {
      const { links, url } = await fetchCollectionPage(collection.base, page);
      console.log(`[oneshot] ${collection.name} page${page} links=`, links.length, url);
      
      for (const productUrl of links) {
        const p = await fetchProductJsonByUrl(productUrl).catch(() => null);
        if (!p) continue;
        if (isTargetProduct(p)) {
          found.push(p);
        }
        // 軽くレートを守る
        await sleep(150);
      }
    }
  }

  if (found.length === 0) {
    console.log('[oneshot] 対象商品なし');
    return;
  }

  console.log('[oneshot] 対象商品リスト（通知想定）:');
  const notifications = [];
  
  for (const p of found) {
    // 新規高額カードページ検知: #数字4桁を含む商品は、hashNumberをidentityに含める
    const hashNumber = p.hashNumber;
    let identity = p.handle || p.productId || p.url;
    if (hashNumber) {
      identity = `${p.handle || p.productId}::#${hashNumber}`;
    }
    
    const prev = await getProductState(identity);
    const prevHashNumber = prev?.lastHashNumber || null;
    const prevStock = prev?.lastTotalStock ?? null;
    const prevPrice = prev?.lastPriceYen ?? null;
    
    // イベント判定（価格変動も含む）
    let eventType = null;
    let notify = false;
    
    if (prevStock === null) {
      // 初回検知
      eventType = 'HighPriceInStock';
      // 新規高額カードページ検知: タイトルに#数字4桁がある場合は特別なイベントタイプ
      if (hashNumber) {
        eventType = 'NewHighPricePage';
      }
      notify = true;
    } else if (hashNumber && prevHashNumber !== hashNumber) {
      // 新規高額カードページ検知: #数字4桁が変わった場合
      eventType = 'NewHighPricePage';
      notify = true;
    } else if (prevPrice !== null && prevPrice !== p.priceYen) {
      // 価格変動（通知しない - 在庫変更のみ通知）
      // notify = false; // 価格変更は通知しない
    } else if (p.totalStock > prevStock) {
      // 在庫増加
      eventType = 'StockIncreased';
      notify = true;
    } else if (prevStock === 0 && p.totalStock > 0) {
      // 再入荷
      eventType = 'BackInStock';
      notify = true;
    } else if (config.notifySoldOut && prevStock !== null && prevStock > 0 && p.totalStock === 0) {
      // 売り切れ通知
      eventType = 'SoldOut';
      notify = true;
    } else if (config.notifyStockDecrease && prevStock !== null && prevStock > p.totalStock && p.totalStock > 0) {
      // 在庫減少通知
      eventType = 'StockDecreased';
      notify = true;
    }
    
    if (notify && eventType) {
      const eid = `${eventType}::${identity}::${p.totalStock}::${p.priceYen}`;
      const isNew = await dedupeCheckAndSet(eid, 60);
      
      if (isNew) {
        // Slackと同じフォーマットで通知メッセージを作成
        const msgParts = [
          `【${eventType}】¥${p.priceYen.toLocaleString()} 在庫${p.totalStock}`,
          p.title,
          p.url,
        ];
        
        if (prevStock !== null) {
          msgParts.push(`前回在庫: ${prevStock}`);
        } else {
          msgParts.push('前回在庫: N/A');
        }
        
        if (prevPrice !== null && prevPrice !== p.priceYen) {
          const priceDelta = p.priceYen - prevPrice;
          const deltaStr = priceDelta > 0 ? `+¥${priceDelta.toLocaleString()}` : `¥${priceDelta.toLocaleString()}`;
          msgParts.push(`前回価格: ¥${prevPrice.toLocaleString()} → ${deltaStr}`);
        }
        
        const message = msgParts.join('\n');
        notifications.push({
          eventType,
          message,
          product: p,
          prevStock,
          prevPrice,
        });
        
        // Slackに送信
        try {
          await sendSlack(message);
          console.log(`[oneshot] Slack送信成功: ${eventType}`);
        } catch (err) {
          console.error(`[oneshot] Slack送信失敗:`, err.message);
        }
        
        // メール通知も送信（設定で有効/無効を切り替え可能）
        if (config.emailEnabled) {
          try {
            await sendEmail(`【${eventType}】${p.title}`, message);
            console.log(`[oneshot] メール送信成功: ${eventType}`);
          } catch (err) {
            console.warn(`[oneshot] メール送信失敗:`, err.message);
          }
        }
      }
    }
    
    // 状態を更新
    await setProductState(identity, {
      lastTotalStock: p.totalStock,
      lastEventType: eventType || (prev?.lastEventType ?? ''),
      lastEventAt: notify ? new Date().toISOString() : (prev?.lastEventAt ?? ''),
      firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString(),
      lastPriceYen: p.priceYen,
      lastHashNumber: hashNumber || '',
    });
  }
  
  // 通知メッセージを表示
  if (notifications.length === 0) {
    console.log('[oneshot] 変動なし（全て既知の状態）');
    console.log('\n[oneshot] 通知メッセージのフォーマット例:');
    console.log('='.repeat(70));
    if (found.length > 0) {
      const example = found[0];
      console.log('【PriceChanged】¥' + example.priceYen.toLocaleString() + ' 在庫' + example.totalStock);
      console.log(example.title);
      console.log(example.url);
      console.log('前回在庫: 1');
      console.log('前回価格: ¥' + (example.priceYen - 5000).toLocaleString() + ' → +¥5,000');
      console.log('-'.repeat(70));
      console.log('【StockIncreased】¥' + example.priceYen.toLocaleString() + ' 在庫' + example.totalStock);
      console.log(example.title);
      console.log(example.url);
      console.log('前回在庫: 0');
      console.log('-'.repeat(70));
    }
  } else {
    console.log(`\n[oneshot] ${notifications.length}件の通知:`);
    console.log('='.repeat(70));
    for (const notif of notifications) {
      console.log(notif.message);
      console.log('-'.repeat(70));
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

