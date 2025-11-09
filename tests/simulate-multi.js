import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { fetchProductJsonByUrl, isTargetProduct } from '../src/product.js';
import { setProductState, getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[simulate-multi] 複数商品の在庫・価格更新シミュレーション開始\n');
  
  // テスト用コレクションを探す（SV-Pまたは最初のコレクション）
  let testCollection = config.collections.find(c => c.name === 'SV-P' || c.name.includes('SV'));
  if (!testCollection) {
    // 見つからない場合は最初のコレクションを使用
    testCollection = config.collections[0];
    console.log(`[simulate-multi] ${testCollection.name}コレクションを使用してテストします\n`);
  } else {
    console.log(`[simulate-multi] ${testCollection.name}コレクションを使用してテストします\n`);
  }
  
  console.log(`[simulate-multi] 対象コレクション: ${testCollection.name}`);
  console.log(`[simulate-multi] 対象ページ: ${Array.isArray(testCollection.pages) ? testCollection.pages.join(',') : testCollection.pages}`);
  console.log(`[simulate-multi] 価格閾値: ${config.priceThresholdYen}\n`);
  
  // 実際の商品を複数取得
  const targetProducts = [];
  const pagesToCheck = Array.isArray(testCollection.pages) ? testCollection.pages.slice(0, 2) : [1, 2];
  for (const page of pagesToCheck) { // 最初の2ページのみ
    const { links } = await fetchCollectionPage(testCollection.base, page);
    console.log(`[simulate-multi] page${page} から商品を検索中... (${links.length}件)`);
    
    for (const productUrl of links.slice(0, 10)) { // 最初の10件を確認
      const p = await fetchProductJsonByUrl(productUrl).catch(() => null);
      if (!p) continue;
      if (isTargetProduct(p)) {
        targetProducts.push(p);
        if (targetProducts.length >= 5) break; // 最大5件
      }
      await sleep(100);
    }
    if (targetProducts.length >= 5) break;
  }
  
  if (targetProducts.length === 0) {
    console.error('[simulate-multi] 対象商品が見つかりませんでした');
    console.log('[simulate-multi] 価格閾値を下げて再試行してください');
    process.exit(1);
  }
  
  console.log(`\n[simulate-multi] ${targetProducts.length}件の商品を発見:\n`);
  
  // 各商品に対して異なるシナリオでシミュレーション
  const scenarios = [
    { name: '在庫増加', prevStock: 0, prevPrice: null, priceChange: 0 },
    { name: '価格上昇', prevStock: 1, prevPrice: -5000, priceChange: 5000 },
    { name: '在庫+価格変動', prevStock: 1, prevPrice: -3000, priceChange: 3000 },
    { name: '再入荷', prevStock: 0, prevPrice: null, priceChange: 0 },
    { name: '在庫増加（複数）', prevStock: 2, prevPrice: null, priceChange: 0 },
  ];
  
  for (let i = 0; i < targetProducts.length && i < scenarios.length; i++) {
    const product = targetProducts[i];
    const scenario = scenarios[i];
    const identity = product.handle || product.productId || product.url;
    
    const simulatedPrevStock = scenario.prevStock;
    const simulatedPrevPrice = scenario.prevPrice !== null 
      ? Math.max(1000, product.priceYen + scenario.prevPrice)
      : product.priceYen;
    
    console.log(`\n[${i + 1}] ${scenario.name}:`);
    console.log(`  商品名: ${product.title}`);
    console.log(`  現在の価格: ¥${product.priceYen.toLocaleString()}`);
    console.log(`  現在の在庫: ${product.totalStock}`);
    console.log(`  前回在庫: ${simulatedPrevStock}`);
    console.log(`  前回価格: ¥${simulatedPrevPrice.toLocaleString()}`);
    
    await setProductState(identity, {
      lastTotalStock: simulatedPrevStock,
      lastEventType: '',
      lastEventAt: new Date(Date.now() - 3600000).toISOString(), // 1時間前
      firstSeenAt: new Date(Date.now() - 86400000).toISOString(), // 1日前
      lastPriceYen: simulatedPrevPrice,
    });
    
    console.log(`  ✅ Redisに書き込み完了`);
  }
  
  console.log(`\n[simulate-multi] シミュレーション完了`);
  console.log(`[simulate-multi] 次のコマンドを実行して通知を確認してください:`);
  console.log(`  PRICE_THRESHOLD_YEN=${config.priceThresholdYen} PAGES=1,2,3 node src/oneshot.js`);
  
  // Redis接続を閉じる
  const redis = getRedis();
  await redis.quit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

