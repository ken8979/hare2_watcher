import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, getRedis } from '../src/redis.js';
// dedupeCheckAndSetはredis.jsからインポート
const dedupeCheckAndSet = redisDedupeCheckAndSet;

// deleteProductStateの代替関数
async function deleteProductState(identity) {
  const redis = getRedis();
  const key = `product_state:${identity}`;
  await redis.del(key);
}
import { sendSlack } from '../src/slack.js';
import { sendBatchEmail } from '../src/email.js';
import { dedupeCheckAndSet as redisDedupeCheckAndSet } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// watch.jsのhandleProduct関数を再現
async function handleProduct(product, collectionName) {
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
    console.warn(`[test-production] identityが空のためスキップ: ${product.title}`);
    return null;
  }
  
  const prev = await getProductState(identity);
  const prevHashNumber = prev?.lastHashNumber || null;
  const prevStock = prev?.lastTotalStock ?? null;
  const prevPrice = prev?.lastPriceYen ?? null;
  const now = new Date().toISOString();

  // イベント判定（watch.jsと同じロジック）
  let notify = false;
  let eventType = 'HighPriceInStock';
  
  if (prevStock === null) {
    // 初回検知（初回検知は通知しない - 在庫変動のみ通知）
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
      console.log(`[test-production] 在庫変動が1未満のため通知スキップ: ${identity} ${prevStock} → ${product.totalStock} (delta=${delta})`);
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
    const stockKey = prevStock !== null ? `${prevStock}->${product.totalStock}` : `null->${product.totalStock}`;
    const priceKey = prevPrice !== null ? `${prevPrice}->${product.priceYen}` : `null->${product.priceYen}`;
    const eid = `${eventType}::${identity}::${stockKey}::${priceKey}`;
    const first = await dedupeCheckAndSet(eid, config.dedupeCooldownSec);
    
    if (first) {
      console.log(`[test-production] ✅ 通知送信: ${eventType} ${identity} 在庫${prevStock ?? 'N/A'}→${product.totalStock}`);
      const cleanTitle = (product.title || '').replace(/\s+/g, ' ').trim();
      const msgParts = [];

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

      const message = msgParts.join('\n');
      await sendSlack(message);

      // メール通知処理（watch.jsと同じロジック）
      if (config.emailEnabled) {
        // collectionNameを優先的に使用（確実にコレクション名と一致させる）
        let queueKey = collectionName;
        if (!queueKey && product.url) {
          // collectionNameが未指定の場合は、URLから推測を試みる
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
            console.log(`[test-production] NewHighPricePageを即時メール送信: ${queueKey}`);
            try {
              await sendBatchEmail(queueKey, [{
                eventType,
                message,
                product,
                timestamp: new Date().toISOString(),
              }]);
              console.log(`[test-production] ✅ 即時メール送信成功: ${queueKey}`);
              return { sent: true, type: 'immediate', eventType, queueKey };
            } catch (error) {
              console.error(`[test-production] ❌ 即時メール送信失敗: ${queueKey}`, error.message);
              return { sent: false, type: 'immediate', eventType, queueKey, error: error.message };
            }
          } else {
            // その他のイベントはキューに追加（コレクション処理完了後にバッチ送信）
            // 必ずcollectionNameを使用（URLから推測した値は使わない）
            const finalQueueKey = collectionName || queueKey;
            
            // テスト用: 即座にメール送信（実際の本番ではキューに追加される）
            console.log(`[test-production] バッチメール送信（シミュレート）: ${finalQueueKey}`);
            try {
              await sendBatchEmail(finalQueueKey, [{
                eventType,
                message,
                product,
                timestamp: new Date().toISOString(),
              }]);
              console.log(`[test-production] ✅ バッチメール送信成功: ${finalQueueKey}`);
              return { sent: true, type: 'batch', eventType, queueKey: finalQueueKey };
            } catch (error) {
              console.error(`[test-production] ❌ バッチメール送信失敗: ${finalQueueKey}`, error.message);
              return { sent: false, type: 'batch', eventType, queueKey: finalQueueKey, error: error.message };
            }
          }
        } else {
          console.warn('[test-production] メール通知キューに追加失敗: collectionNameが不明');
          return { sent: false, type: 'unknown', eventType, error: 'collectionName不明' };
        }
      } else {
        console.log('[test-production] メール通知は無効化されています');
        return { sent: false, type: 'disabled', eventType };
      }
    } else {
      console.log(`[test-production] ⏭️  重複防止により通知スキップ: ${identity}`);
      return { sent: false, type: 'dedupe', eventType };
    }
  } else {
    console.log(`[test-production] 通知なし: ${identity} (prevStock=${prevStock}, currentStock=${product.totalStock})`);
    return { sent: false, type: 'no-notify', eventType: null };
  }

  // 状態を保存（通知の有無に関わらず、常に保存）
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
      console.log(`[test-production] 初回検知: ${identity} 在庫${product.totalStock} - 状態を保存（通知なし）`);
    }
  } catch (error) {
    console.error(`[test-production] Redis状態保存失敗: ${identity}`, error.message);
  }
  
  return { sent: false, type: 'no-notify', eventType: null };
}

async function main() {
  console.log('[test-production-email-flow] 本番処理フロー再現テスト');
  console.log('[test-production-email-flow] ========================================');
  
  // 設定確認
  console.log('[test-production-email-flow] 設定確認:');
  console.log(`  EMAIL_ENABLED: ${config.emailEnabled}`);
  console.log(`  EMAIL_TO: ${config.emailTo || '(未設定)'}`);
  console.log(`  PRICE_THRESHOLD_YEN: ¥${config.priceThresholdYen.toLocaleString()}`);
  console.log('[test-production-email-flow] ========================================\n');
  
  if (!config.emailEnabled) {
    console.error('[test-production-email-flow] ❌ メール通知が無効化されています');
    process.exit(1);
  }
  
  if (!config.emailTo) {
    console.error('[test-production-email-flow] ❌ EMAIL_TOが設定されていません');
    process.exit(1);
  }
  
  // コレクションを取得
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-production-email-flow] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-production-email-flow] 対象コレクション: ${collection.name}`);
  console.log(`[test-production-email-flow] 商品を取得中...\n`);
  
  // 実際の商品を取得
  const page = Array.isArray(collection.pages) ? collection.pages[0] : 1;
  let products = null;
  let retries = 3;
  while (retries > 0 && !products) {
    try {
      const result = await fetchCollectionPage(collection.base, page);
      products = result.products;
      break;
    } catch (error) {
      retries--;
      if (retries > 0) {
        console.log(`[test-production-email-flow] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-production-email-flow] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  // 対象商品を探す（最大3件）
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 3) break;
    }
  }
  
  if (targetProducts.length === 0) {
    console.error('[test-production-email-flow] ❌ 対象商品（価格閾値以上、在庫あり）が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`[test-production-email-flow] ${targetProducts.length}件の対象商品を発見:\n`);
  targetProducts.forEach((product, index) => {
    console.log(`  ${index + 1}. ${product.title.substring(0, 50)}...`);
    console.log(`     価格: ¥${product.priceYen.toLocaleString()}, 在庫: ${product.totalStock}`);
    if (product.hashNumber) {
      console.log(`     hashNumber: #${product.hashNumber}`);
    }
    console.log('');
  });
  
  const redis = getRedis();
  const results = [];
  
  // シナリオ1: 在庫増加（0→1以上）
  console.log('[test-production-email-flow] ========================================');
  console.log('[test-production-email-flow] シナリオ1: 在庫増加（0→1以上）をシミュレート');
  console.log('[test-production-email-flow] ========================================\n');
  
  const product1 = targetProducts[0];
  const hashNumber1 = product1.hashNumber;
  let identity1 = product1.handle || product1.productId;
  if (!identity1 && product1.url) {
    try {
      const urlObj = new URL(product1.url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2 && pathParts[0] === 'products') {
        identity1 = pathParts[1];
      } else {
        identity1 = product1.url;
      }
    } catch {
      identity1 = product1.url;
    }
  }
  if (hashNumber1) {
    identity1 = `${identity1}::#${hashNumber1}`;
  }
  
  // Redisの状態を設定（前回在庫0）
  await setProductState(identity1, {
    lastTotalStock: 0,
    lastEventType: 'BackInStock',
    lastEventAt: new Date(Date.now() - 60000).toISOString(),
    firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
    lastPriceYen: product1.priceYen,
    lastHashNumber: hashNumber1 || '',
  });
  
  console.log(`[test-production-email-flow] 商品1の前回状態を設定: 在庫0 → 現在在庫${product1.totalStock}`);
  
  // 重複防止キーをクリア（テスト用）
  const dedupeKeys1 = await redis.keys(`dedupe:event:*::${identity1}::*`);
  if (dedupeKeys1.length > 0) {
    await redis.del(...dedupeKeys1);
    console.log(`[test-production-email-flow] 重複防止キーをクリア: ${dedupeKeys1.length}件\n`);
  }
  
  const result1 = await handleProduct(product1, collection.name);
  results.push({ scenario: '在庫増加（0→1以上）', product: product1, result: result1 });
  await sleep(2000);
  
  // シナリオ2: 在庫増加（1→2以上）
  if (targetProducts.length >= 2 && product1.totalStock >= 2) {
    console.log('\n[test-production-email-flow] ========================================');
    console.log('[test-production-email-flow] シナリオ2: 在庫増加（1→2以上）をシミュレート');
    console.log('[test-production-email-flow] ========================================\n');
    
    const product2 = targetProducts[1];
    const hashNumber2 = product2.hashNumber;
    let identity2 = product2.handle || product2.productId;
    if (!identity2 && product2.url) {
      try {
        const urlObj = new URL(product2.url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'products') {
          identity2 = pathParts[1];
        } else {
          identity2 = product2.url;
        }
      } catch {
        identity2 = product2.url;
      }
    }
    if (hashNumber2) {
      identity2 = `${identity2}::#${hashNumber2}`;
    }
    
    // Redisの状態を設定（前回在庫1）
    await setProductState(identity2, {
      lastTotalStock: 1,
      lastEventType: 'StockIncreased',
      lastEventAt: new Date(Date.now() - 60000).toISOString(),
      firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
      lastPriceYen: product2.priceYen,
      lastHashNumber: hashNumber2 || '',
    });
    
    console.log(`[test-production-email-flow] 商品2の前回状態を設定: 在庫1 → 現在在庫${product2.totalStock}`);
    
    // 重複防止キーをクリア（テスト用）
    const dedupeKeys2 = await redis.keys(`dedupe:event:*::${identity2}::*`);
    if (dedupeKeys2.length > 0) {
      await redis.del(...dedupeKeys2);
      console.log(`[test-production-email-flow] 重複防止キーをクリア: ${dedupeKeys2.length}件\n`);
    }
    
    const result2 = await handleProduct(product2, collection.name);
    results.push({ scenario: '在庫増加（1→2以上）', product: product2, result: result2 });
    await sleep(2000);
  }
  
  // シナリオ3: NewHighPricePage（#数字4桁の新規追加）
  const productWithHash = targetProducts.find(p => p.hashNumber);
  if (productWithHash) {
    console.log('\n[test-production-email-flow] ========================================');
    console.log('[test-production-email-flow] シナリオ3: NewHighPricePage（#数字4桁の新規追加）をシミュレート');
    console.log('[test-production-email-flow] ========================================\n');
    
    const product3 = productWithHash;
    const hashNumber3 = product3.hashNumber;
    let identity3 = product3.handle || product3.productId;
    if (!identity3 && product3.url) {
      try {
        const urlObj = new URL(product3.url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'products') {
          identity3 = pathParts[1];
        } else {
          identity3 = product3.url;
        }
      } catch {
        identity3 = product3.url;
      }
    }
    identity3 = `${identity3}::#${hashNumber3}`;
    
    // Redisの状態をクリア（初回検知として扱う）
    await deleteProductState(identity3);
    console.log(`[test-production-email-flow] 商品3の状態をクリア（初回検知として扱う）: #${hashNumber3}`);
    
    // 重複防止キーをクリア（テスト用）
    const dedupeKeys3 = await redis.keys(`dedupe:event:*::${identity3}::*`);
    if (dedupeKeys3.length > 0) {
      await redis.del(...dedupeKeys3);
      console.log(`[test-production-email-flow] 重複防止キーをクリア: ${dedupeKeys3.length}件\n`);
    }
    
    const result3 = await handleProduct(product3, collection.name);
    results.push({ scenario: 'NewHighPricePage（#数字4桁の新規追加）', product: product3, result: result3 });
    await sleep(2000);
  }
  
  // 結果サマリー
  console.log('\n[test-production-email-flow] ========================================');
  console.log('[test-production-email-flow] テスト結果サマリー');
  console.log('[test-production-email-flow] ========================================\n');
  
  let successCount = 0;
  let failCount = 0;
  
  results.forEach((r, index) => {
    console.log(`シナリオ ${index + 1}: ${r.scenario}`);
    console.log(`  商品: ${r.product.title.substring(0, 40)}...`);
    console.log(`  結果: ${r.result.sent ? '✅ メール送信成功' : '❌ メール送信なし'}`);
    if (r.result.sent) {
      console.log(`  送信タイプ: ${r.result.type}`);
      console.log(`  イベントタイプ: ${r.result.eventType}`);
      console.log(`  キューキー: ${r.result.queueKey}`);
      successCount++;
    } else {
      console.log(`  理由: ${r.result.type}`);
      if (r.result.error) {
        console.log(`  エラー: ${r.result.error}`);
      }
      failCount++;
    }
    console.log('');
  });
  
  console.log('[test-production-email-flow] ========================================');
  console.log(`[test-production-email-flow] 成功: ${successCount}件, 失敗: ${failCount}件`);
  console.log('[test-production-email-flow] ========================================\n');
  
  if (successCount > 0) {
    console.log(`[test-production-email-flow] ✅ ${successCount}通のメールが送信されました`);
    console.log(`[test-production-email-flow] ${config.emailTo} の受信ボックス（および迷惑メールフォルダ）を確認してください。\n`);
  } else {
    console.log(`[test-production-email-flow] ⚠️  メールが送信されませんでした`);
    console.log(`[test-production-email-flow] ログを確認して、原因を特定してください。\n`);
  }
  
  await redis.quit();
  console.log('[test-production-email-flow] テスト完了');
}

main().catch(err => {
  console.error('[test-production-email-flow] エラー:', err);
  process.exit(1);
});

