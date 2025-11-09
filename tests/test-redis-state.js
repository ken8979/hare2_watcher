import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState } from '../src/redis.js';
import { getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-redis-state] Redis状態の確認テスト');
  
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-redis-state] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-redis-state] 対象コレクション: ${collection.name}`);
  
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
        console.log(`[test-redis-state] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-redis-state] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  // 対象商品を探す
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 5) break;
    }
  }
  
  if (targetProducts.length === 0) {
    console.error('[test-redis-state] ❌ 対象商品が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`\n[test-redis-state] ${targetProducts.length}件の商品を確認`);
  
  const redis = getRedis();
  
  for (const product of targetProducts) {
    const hashNumber = product.hashNumber;
    let identity = product.handle || product.productId || product.url;
    if (hashNumber) {
      identity = `${product.handle || product.productId}::#${hashNumber}`;
    }
    
    console.log(`\n[test-redis-state] 商品: ${product.title.substring(0, 40)}...`);
    console.log(`  Identity: ${identity}`);
    console.log(`  現在の在庫: ${product.totalStock}`);
    console.log(`  現在の価格: ¥${product.priceYen.toLocaleString()}`);
    
    // Redisから状態を取得
    const state = await getProductState(identity);
    if (state) {
      console.log(`  Redis状態:`);
      console.log(`    前回在庫: ${state.lastTotalStock ?? 'null'}`);
      console.log(`    前回価格: ${state.lastPriceYen ? `¥${state.lastPriceYen.toLocaleString()}` : 'null'}`);
      console.log(`    最終イベント: ${state.lastEventType || 'N/A'}`);
      console.log(`    最終イベント時刻: ${state.lastEventAt || 'N/A'}`);
      console.log(`    初回検知時刻: ${state.firstSeenAt || 'N/A'}`);
    } else {
      console.log(`  Redis状態: なし（初回検知）`);
    }
    
    // Redisキーを直接確認
    const redisKey = `product_state:${identity}`;
    const rawData = await redis.hgetall(redisKey);
    console.log(`  Redisキー: ${redisKey}`);
    console.log(`  Redis生データ:`, rawData);
  }
  
  // 重複防止キーも確認
  console.log(`\n[test-redis-state] 重複防止キーの確認（サンプル）`);
  const sampleProduct = targetProducts[0];
  const hashNumber = sampleProduct.hashNumber;
  let identity = sampleProduct.handle || sampleProduct.productId || sampleProduct.url;
  if (hashNumber) {
    identity = `${sampleProduct.handle || sampleProduct.productId}::#${hashNumber}`;
  }
  
  const eventId = `HighPriceInStock::${identity}::null->${sampleProduct.totalStock}::null->${sampleProduct.priceYen}`;
  const dedupeKey = `dedupe:event:${eventId}`;
  const dedupeValue = await redis.get(dedupeKey);
  console.log(`  イベントID: ${eventId}`);
  console.log(`  重複防止キー: ${dedupeKey}`);
  console.log(`  値: ${dedupeValue || 'なし'}`);
  
  await redis.quit();
  console.log('\n[test-redis-state] テスト完了');
}

main().catch(err => {
  console.error('[test-redis-state] エラー:', err);
  process.exit(1);
});

