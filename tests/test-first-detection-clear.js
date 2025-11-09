import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, dedupeCheckAndSet, getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-first-detection-clear] 初回検知の通知テスト（Redis状態クリア版）');
  console.log('[test-first-detection-clear] 期待される動作: 初回検知の商品は通知されない（状態のみ保存）');
  
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-first-detection-clear] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-first-detection-clear] 対象コレクション: ${collection.name}`);
  
  // 最初のページから商品を取得
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
        console.log(`[test-first-detection-clear] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-first-detection-clear] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  // 対象商品を探す
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 3) break; // 3件まで
    }
  }
  
  if (targetProducts.length === 0) {
    console.error('[test-first-detection-clear] ❌ 対象商品が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`\n[test-first-detection-clear] ${targetProducts.length}件の商品をテスト`);
  
  const redis = getRedis();
  
  // テスト対象商品のRedis状態をクリア
  console.log(`\n[test-first-detection-clear] テスト対象商品のRedis状態をクリア中...`);
  for (const product of targetProducts) {
    const hashNumber = product.hashNumber;
    let identity = product.handle || product.productId;
    
    if (!identity && product.url) {
      try {
        const urlObj = new URL(product.url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'products') {
          identity = pathParts[1];
        } else {
          identity = product.url;
        }
      } catch {
        identity = product.url;
      }
    }
    
    if (hashNumber) {
      identity = `${identity}::#${hashNumber}`;
    }
    
    const redisKey = `product_state:${identity}`;
    await redis.del(redisKey);
    console.log(`  ✓ ${identity} の状態をクリア`);
  }
  
  let notifiedCount = 0;
  let skippedCount = 0;
  
  console.log(`\n[test-first-detection-clear] 初回検知の動作をテスト...`);
  
  for (const product of targetProducts) {
    const hashNumber = product.hashNumber;
    let identity = product.handle || product.productId;
    
    if (!identity && product.url) {
      try {
        const urlObj = new URL(product.url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'products') {
          identity = pathParts[1];
        } else {
          identity = product.url;
        }
      } catch {
        identity = product.url;
      }
    }
    
    if (hashNumber) {
      identity = `${identity}::#${hashNumber}`;
    }
    
    console.log(`\n[test-first-detection-clear] 商品: ${product.title.substring(0, 50)}...`);
    console.log(`  Identity: ${identity}`);
    console.log(`  現在の在庫: ${product.totalStock}`);
    console.log(`  現在の価格: ¥${product.priceYen.toLocaleString()}`);
    
    // Redisから状態を取得（クリア後なのでnullになるはず）
    const prev = await getProductState(identity);
    const prevStock = prev?.lastTotalStock ?? null;
    const prevPrice = prev?.lastPriceYen ?? null;
    
    console.log(`  前回在庫: ${prevStock ?? 'N/A (初回検知)'}`);
    console.log(`  前回価格: ${prevPrice ? `¥${prevPrice.toLocaleString()}` : 'N/A'}`);
    
    // イベント判定ロジックをシミュレート（watch.jsと同じロジック）
    let notify = false;
    let eventType = 'HighPriceInStock';
    
    if (prevStock === null) {
      // 初回検知（通知しない）
      notify = false;
      eventType = 'HighPriceInStock';
      if (hashNumber) {
        eventType = 'NewHighPricePage';
        notify = true; // NewHighPricePageの場合は通知
      }
      console.log(`  → 初回検知: ${notify ? '通知あり（NewHighPricePage）' : '通知なし（状態のみ保存）'}`);
    } else if (prevStock === 0 && product.totalStock > 0) {
      notify = true;
      eventType = 'BackInStock';
      console.log(`  → 再入荷: 通知あり`);
    } else if (prevStock !== null && product.totalStock > prevStock) {
      const delta = product.totalStock - prevStock;
      if (delta >= 1) {
        notify = true;
        eventType = 'StockIncreased';
        console.log(`  → 在庫増加: 通知あり (${prevStock} → ${product.totalStock})`);
      } else {
        console.log(`  → 在庫変動が1未満のため通知スキップ`);
      }
    } else {
      console.log(`  → 変動なし: 通知なし`);
    }
    
    if (notify) {
      // 重複防止チェック
      const stockKey = prevStock !== null ? `${prevStock}->${product.totalStock}` : `null->${product.totalStock}`;
      const priceKey = prevPrice !== null ? `${prevPrice}->${product.priceYen}` : `null->${product.priceYen}`;
      const eid = `${eventType}::${identity}::${stockKey}::${priceKey}`;
      const first = await dedupeCheckAndSet(eid, config.dedupeCooldownSec);
      
      if (first) {
        console.log(`  ✅ 通知送信: ${eventType}`);
        notifiedCount++;
      } else {
        console.log(`  ⏭️  重複防止により通知スキップ`);
        skippedCount++;
      }
    } else {
      skippedCount++;
    }
    
    // 状態を保存（通知の有無に関わらず）
    try {
      await setProductState(identity, {
        lastTotalStock: product.totalStock,
        lastEventType: notify ? eventType : (prev?.lastEventType ?? ''),
        lastEventAt: notify ? new Date().toISOString() : (prev?.lastEventAt ?? ''),
        firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString(),
        lastPriceYen: product.priceYen,
        lastHashNumber: hashNumber || '',
      });
      if (prevStock === null && !notify) {
        console.log(`  💾 状態を保存（通知なし）`);
      }
    } catch (error) {
      console.error(`  ❌ Redis状態保存失敗:`, error.message);
    }
  }
  
  console.log(`\n[test-first-detection-clear] テスト結果:`);
  console.log(`  通知件数: ${notifiedCount}件`);
  console.log(`  スキップ件数: ${skippedCount}件`);
  console.log(`  合計: ${targetProducts.length}件`);
  
  // 2回目の実行（同じ商品を再度処理）
  console.log(`\n[test-first-detection-clear] 2回目の実行（同じ商品を再度処理）...`);
  console.log(`[test-first-detection-clear] 期待される動作: 既に状態が保存されているため、通知されない`);
  
  let notifiedCount2 = 0;
  let skippedCount2 = 0;
  
  for (const product of targetProducts) {
    const hashNumber = product.hashNumber;
    let identity = product.handle || product.productId;
    
    if (!identity && product.url) {
      try {
        const urlObj = new URL(product.url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'products') {
          identity = pathParts[1];
        } else {
          identity = product.url;
        }
      } catch {
        identity = product.url;
      }
    }
    
    if (hashNumber) {
      identity = `${identity}::#${hashNumber}`;
    }
    
    const prev = await getProductState(identity);
    const prevStock = prev?.lastTotalStock ?? null;
    
    if (prevStock === null) {
      console.log(`  ⚠️  ${identity}: 状態が保存されていません`);
    } else {
      console.log(`  ✓ ${identity}: 状態が保存されています（在庫: ${prevStock}）`);
    }
    
    // イベント判定
    let notify = false;
    if (prevStock === null) {
      notify = hashNumber ? true : false; // NewHighPricePageの場合は通知
    } else if (prevStock === product.totalStock) {
      notify = false; // 変動なし
    }
    
    if (notify) {
      notifiedCount2++;
    } else {
      skippedCount2++;
    }
  }
  
  console.log(`\n[test-first-detection-clear] 2回目のテスト結果:`);
  console.log(`  通知件数: ${notifiedCount2}件`);
  console.log(`  スキップ件数: ${skippedCount2}件`);
  
  if (notifiedCount2 === 0) {
    console.log(`\n✅ 期待通り: 2回目の実行では通知されませんでした（状態が保存されているため）`);
  } else {
    console.log(`\n⚠️  注意: ${notifiedCount2}件の通知が発生しました`);
  }
  
  await redis.quit();
  console.log('\n[test-first-detection-clear] テスト完了');
}

main().catch(err => {
  console.error('[test-first-detection-clear] エラー:', err);
  process.exit(1);
});

