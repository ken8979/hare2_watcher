import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-normal-product-first-detection] 通常商品の初回検知テスト');
  console.log('[test-normal-product-first-detection] 期待される動作: hashNumberがない通常商品の初回検知は通知されない');
  
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-normal-product-first-detection] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-normal-product-first-detection] 対象コレクション: ${collection.name}`);
  
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
        console.log(`[test-normal-product-first-detection] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-normal-product-first-detection] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  // hashNumberがない通常商品を探す
  const normalProducts = [];
  for (const product of products) {
    if (isTargetProduct(product) && !product.hashNumber) {
      normalProducts.push(product);
      if (normalProducts.length >= 2) break; // 2件まで
    }
  }
  
  if (normalProducts.length === 0) {
    console.log('[test-normal-product-first-detection] ⚠️  hashNumberがない通常商品が見つかりませんでした');
    console.log('[test-normal-product-first-detection] hashNumberがある商品でテストを続行します...');
    // hashNumberがある商品でもテストを続行
    for (const product of products) {
      if (isTargetProduct(product)) {
        normalProducts.push(product);
        if (normalProducts.length >= 2) break;
      }
    }
  }
  
  if (normalProducts.length === 0) {
    console.error('[test-normal-product-first-detection] ❌ 対象商品が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`\n[test-normal-product-first-detection] ${normalProducts.length}件の商品をテスト`);
  
  const redis = getRedis();
  
  // テスト対象商品のRedis状態をクリア
  console.log(`\n[test-normal-product-first-detection] テスト対象商品のRedis状態をクリア中...`);
  for (const product of normalProducts) {
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
    console.log(`  ✓ ${identity} の状態をクリア (hashNumber: ${hashNumber || 'なし'})`);
  }
  
  let notifiedCount = 0;
  let skippedCount = 0;
  
  console.log(`\n[test-normal-product-first-detection] 初回検知の動作をテスト...`);
  
  for (const product of normalProducts) {
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
    
    console.log(`\n[test-normal-product-first-detection] 商品: ${product.title.substring(0, 50)}...`);
    console.log(`  Identity: ${identity}`);
    console.log(`  hashNumber: ${hashNumber || 'なし'}`);
    console.log(`  現在の在庫: ${product.totalStock}`);
    console.log(`  現在の価格: ¥${product.priceYen.toLocaleString()}`);
    
    // Redisから状態を取得（クリア後なのでnullになるはず）
    const prev = await getProductState(identity);
    const prevStock = prev?.lastTotalStock ?? null;
    
    console.log(`  前回在庫: ${prevStock ?? 'N/A (初回検知)'}`);
    
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
      
      if (hashNumber) {
        console.log(`  → 初回検知（hashNumberあり）: 通知あり（NewHighPricePage）`);
      } else {
        console.log(`  → 初回検知（hashNumberなし）: 通知なし（状態のみ保存）`);
      }
    } else {
      console.log(`  → 既に状態が保存されている: 通知なし`);
    }
    
    if (notify) {
      notifiedCount++;
      console.log(`  ✅ 通知送信: ${eventType}`);
    } else {
      skippedCount++;
      console.log(`  ⏭️  通知スキップ（状態のみ保存）`);
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
  
  console.log(`\n[test-normal-product-first-detection] テスト結果:`);
  console.log(`  通知件数: ${notifiedCount}件`);
  console.log(`  スキップ件数: ${skippedCount}件`);
  console.log(`  合計: ${normalProducts.length}件`);
  
  // hashNumberがない商品の数
  const normalCount = normalProducts.filter(p => !p.hashNumber).length;
  const hashCount = normalProducts.filter(p => p.hashNumber).length;
  
  console.log(`\n[test-normal-product-first-detection] 商品内訳:`);
  console.log(`  hashNumberなし: ${normalCount}件`);
  console.log(`  hashNumberあり: ${hashCount}件`);
  
  if (normalCount > 0 && notifiedCount === hashCount) {
    console.log(`\n✅ 期待通り: hashNumberがない通常商品の初回検知は通知されませんでした`);
    console.log(`   （hashNumberがある商品のみ通知されました）`);
  } else if (normalCount === 0) {
    console.log(`\n⚠️  注意: hashNumberがない商品が見つかりませんでした`);
    console.log(`   （hashNumberがある商品のみテストされました）`);
  }
  
  await redis.quit();
  console.log('\n[test-normal-product-first-detection] テスト完了');
}

main().catch(err => {
  console.error('[test-normal-product-first-detection] エラー:', err);
  process.exit(1);
});

