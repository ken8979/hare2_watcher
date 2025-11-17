import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-detection-logic] 在庫・価格変更検知ロジックテスト');
  console.log('[test-detection-logic] ========================================\n');
  
  // 設定確認
  console.log('[test-detection-logic] 設定確認:');
  console.log(`  PRICE_THRESHOLD_YEN: ¥${config.priceThresholdYen.toLocaleString()}`);
  console.log(`  EMAIL_ENABLED: ${config.emailEnabled}`);
  console.log(`  SLEEP_BETWEEN_PAGES_MS: ${config.sleepBetweenPagesMs}ms`);
  console.log(`  SLEEP_BETWEEN_PRODUCTS_MS: ${config.sleepBetweenProductsMs}ms`);
  console.log(`  SLEEP_BETWEEN_COLLECTIONS_MS: ${config.sleepBetweenCollectionsMs}ms`);
  console.log(`  MAIN_LOOP_SLEEP_MS: ${config.mainLoopSleepMs}ms\n`);
  
  // コレクションを取得
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-detection-logic] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-detection-logic] 対象コレクション: ${collection.name}`);
  console.log(`[test-detection-logic] ページ数: ${Array.isArray(collection.pages) ? collection.pages.length : 'N/A'}\n`);
  
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
        console.log(`[test-detection-logic] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-detection-logic] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`[test-detection-logic] 取得した商品数: ${products.length}件\n`);
  
  // 対象商品を探す
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 5) break;
    }
  }
  
  if (targetProducts.length === 0) {
    console.error('[test-detection-logic] ❌ 対象商品（価格閾値以上、在庫あり）が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`[test-detection-logic] 対象商品数: ${targetProducts.length}件\n`);
  
  // 各商品の状態を確認
  const redis = getRedis();
  const stateChecks = [];
  
  for (let i = 0; i < targetProducts.length; i++) {
    const product = targetProducts[i];
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
    
    console.log(`[test-detection-logic] 商品 ${i + 1}: ${product.title.substring(0, 40)}...`);
    console.log(`  Identity: ${identity}`);
    console.log(`  現在の状態:`);
    console.log(`    在庫: ${product.totalStock}`);
    console.log(`    価格: ¥${product.priceYen.toLocaleString()}`);
    if (hashNumber) {
      console.log(`    hashNumber: #${hashNumber}`);
    }
    console.log(`  前回の状態:`);
    if (prev) {
      console.log(`    在庫: ${prev.lastTotalStock ?? 'N/A'}`);
      console.log(`    価格: ${prev.lastPriceYen ? `¥${prev.lastPriceYen.toLocaleString()}` : 'N/A'}`);
      console.log(`    最終イベント: ${prev.lastEventType ?? 'N/A'}`);
      console.log(`    最終イベント時刻: ${prev.lastEventAt ?? 'N/A'}`);
      
      // 変更検知のシミュレーション
      let wouldNotify = false;
      let eventType = null;
      
      if (prev.lastTotalStock === null) {
        // 初回検知
        if (hashNumber) {
          wouldNotify = true;
          eventType = 'NewHighPricePage';
        } else {
          wouldNotify = false;
          eventType = 'HighPriceInStock';
        }
      } else if (hashNumber && prev.lastHashNumber !== hashNumber) {
        wouldNotify = true;
        eventType = 'NewHighPricePage';
      } else if (prev.lastTotalStock === 0 && product.totalStock > 0) {
        wouldNotify = true;
        eventType = 'BackInStock';
      } else if (prev.lastTotalStock !== null && product.totalStock > prev.lastTotalStock) {
        const delta = product.totalStock - prev.lastTotalStock;
        if (delta >= 1) {
          wouldNotify = true;
          eventType = 'StockIncreased';
        }
      } else if (prev.lastPriceYen !== null && prev.lastPriceYen !== product.priceYen) {
        // 価格変更（通知しない設定）
        wouldNotify = false;
        eventType = 'PriceChanged';
      }
      
      if (wouldNotify) {
        console.log(`  ✅ 通知が送信される: ${eventType}`);
        stateChecks.push({ product, identity, wouldNotify: true, eventType });
      } else {
        console.log(`  ⏭️  通知なし: ${eventType || '変更なし'}`);
        stateChecks.push({ product, identity, wouldNotify: false, eventType });
      }
    } else {
      console.log(`  ⚠️  Redisに状態が保存されていない（初回検知）`);
      if (hashNumber) {
        console.log(`  ✅ NewHighPricePageとして通知される`);
        stateChecks.push({ product, identity, wouldNotify: true, eventType: 'NewHighPricePage' });
      } else {
        console.log(`  ⏭️  通常の初回検知は通知されない`);
        stateChecks.push({ product, identity, wouldNotify: false, eventType: 'HighPriceInStock' });
      }
    }
    console.log('');
  }
  
  // サマリー
  console.log('[test-detection-logic] ========================================');
  console.log('[test-detection-logic] 検知ロジックテスト結果');
  console.log('[test-detection-logic] ========================================\n');
  
  const notifyCount = stateChecks.filter(s => s.wouldNotify).length;
  const noNotifyCount = stateChecks.filter(s => !s.wouldNotify).length;
  
  console.log(`通知が送信される商品: ${notifyCount}件`);
  console.log(`通知が送信されない商品: ${noNotifyCount}件\n`);
  
  if (notifyCount > 0) {
    console.log('通知が送信される商品:');
    stateChecks.filter(s => s.wouldNotify).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.product.title.substring(0, 40)}... (${s.eventType})`);
    });
    console.log('');
  }
  
  // 潜在的な問題のチェック
  console.log('[test-detection-logic] ========================================');
  console.log('[test-detection-logic] 潜在的な問題のチェック');
  console.log('[test-detection-logic] ========================================\n');
  
  // 状態保存の確認（非同期のため、直接チェックできないが、ログで確認）
  const stateNotSaved = stateChecks.filter(s => {
    // 実際の状態は既に確認済み
    return false; // このチェックは既に上で実施済み
  });
  
  const firstDetectionCount = stateChecks.filter(s => {
    // 初回検知の商品数をカウント
    return s.eventType === 'HighPriceInStock' && !s.wouldNotify;
  }).length;
  
  if (firstDetectionCount > 0) {
    console.log(`⚠️  ${firstDetectionCount}件の商品が初回検知として扱われています`);
    console.log('   これらは状態が保存されるだけで、通知は送信されません');
    console.log('   実際の在庫変動を検知するには、次回のチェックで状態が更新される必要があります\n');
  }
  
  // スリープ時間の影響を確認
  const totalSleepTime = 
    config.sleepBetweenPagesMs * (Array.isArray(collection.pages) ? collection.pages.length : 1) +
    config.sleepBetweenProductsMs * targetProducts.length +
    config.sleepBetweenCollectionsMs +
    config.mainLoopSleepMs;
  
  console.log(`スリープ時間の合計（1コレクション処理）: ${totalSleepTime}ms (${(totalSleepTime / 1000).toFixed(1)}秒)`);
  console.log(`  ページ処理間: ${config.sleepBetweenPagesMs}ms × ${Array.isArray(collection.pages) ? collection.pages.length : 1}ページ`);
  console.log(`  商品処理間: ${config.sleepBetweenProductsMs}ms × ${targetProducts.length}商品`);
  console.log(`  コレクション処理間: ${config.sleepBetweenCollectionsMs}ms`);
  console.log(`  メインループ: ${config.mainLoopSleepMs}ms\n`);
  
  if (totalSleepTime > 10000) {
    console.log('⚠️  スリープ時間が長すぎる可能性があります');
    console.log('   これにより、実際の変更を検知する前に状態が更新されてしまう可能性があります\n');
  }
  
  await redis.quit();
  console.log('[test-detection-logic] テスト完了');
}

main().catch(err => {
  console.error('[test-detection-logic] エラー:', err);
  process.exit(1);
});

