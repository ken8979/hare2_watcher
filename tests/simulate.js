import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { fetchProductJsonByUrl, isTargetProduct } from '../src/product.js';
import { setProductState, getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[simulate] シミュレーション開始: 在庫発生をシミュレート');
  const collection = config.collections[0];
  console.log('[simulate] 対象コレクション:', collection.name);
  console.log('[simulate] 対象ページ:', Array.isArray(collection.pages) ? collection.pages.join(',') : collection.pages);
  console.log('[simulate] 価格閾値:', config.priceThresholdYen);
  
  // 実際の商品を1つ取得（在庫が2以上の商品を優先的に探す）
  let targetProduct = null;
  let candidateWithStock2Plus = null;
  
  for (const page of collection.pages) {
    const { links } = await fetchCollectionPage(collection.base, page);
    console.log(`[simulate] page${page} から商品を検索中...`);
    
    for (const productUrl of links.slice(0, 20)) { // 最初の20件を確認
      const p = await fetchProductJsonByUrl(productUrl).catch(() => null);
      if (!p) continue;
      if (isTargetProduct(p)) {
        // 在庫が2以上の商品を優先的に探す
        if (p.totalStock >= 2 && !candidateWithStock2Plus) {
          candidateWithStock2Plus = p;
        }
        // 最初に見つかった商品を候補として保持
        if (!targetProduct) {
          targetProduct = p;
        }
      }
      await sleep(100);
    }
    // 在庫2以上の商品が見つかったら、それを優先
    if (candidateWithStock2Plus) {
      targetProduct = candidateWithStock2Plus;
      break;
    }
    if (targetProduct) break;
  }
  
  if (!targetProduct) {
    console.error('[simulate] 対象商品が見つかりませんでした');
    process.exit(1);
  }
  
  const identity = targetProduct.handle || targetProduct.productId || targetProduct.url;
  console.log('\n[simulate] 対象商品を発見:');
  console.log('  商品名:', targetProduct.title);
  console.log('  現在の価格: ¥' + targetProduct.priceYen.toLocaleString());
  console.log('  現在の在庫:', targetProduct.totalStock);
  console.log('  URL:', targetProduct.url);
  console.log('  Identity:', identity);
  
  // シミュレーション: 前回の状態を書き込む
  // ケース1: 在庫0 → 現在の在庫（再入荷シミュレーション）
  // ケース2: 在庫数が増加（例：1→3、2→5など）
  // ケース3: 価格は変動なし（在庫変動のみをテスト）
  // 在庫変動のテストのため、価格は現在と同じに設定
  const simulatedPrevPrice = targetProduct.priceYen;
  
  // 在庫数の増加をシミュレート
  // 現在の在庫が1以上の場合、前回の在庫を現在より少なく設定
  // 現在の在庫が1の場合、前回は0（再入荷）
  // 現在の在庫が2以上の場合、前回は現在の半分程度
  let simulatedPrevStock;
  if (targetProduct.totalStock === 0) {
    // 現在在庫0の場合は、前回も0として扱う（変動なし）
    simulatedPrevStock = 0;
  } else if (targetProduct.totalStock === 1) {
    // 現在在庫1の場合は、前回は0（再入荷シミュレーション）
    simulatedPrevStock = 0;
  } else {
    // 現在在庫2以上の場合、前回は現在より少なく設定（在庫増加シミュレーション）
    simulatedPrevStock = Math.max(1, Math.floor(targetProduct.totalStock / 2));
  }
  
  console.log('\n[simulate] Redisに前回の状態を書き込み:');
  console.log('  前回在庫:', simulatedPrevStock);
  console.log('  現在在庫:', targetProduct.totalStock);
  console.log('  在庫変動:', simulatedPrevStock, '→', targetProduct.totalStock, '(+' + (targetProduct.totalStock - simulatedPrevStock) + ')');
  console.log('  前回価格: ¥' + simulatedPrevPrice.toLocaleString());
  console.log('  現在価格: ¥' + targetProduct.priceYen.toLocaleString());
  
  await setProductState(identity, {
    lastTotalStock: simulatedPrevStock,
    lastEventType: '',
    lastEventAt: new Date(Date.now() - 3600000).toISOString(), // 1時間前
    firstSeenAt: new Date(Date.now() - 86400000).toISOString(), // 1日前
    lastPriceYen: simulatedPrevPrice,
  });
  
  console.log('[simulate] 書き込み完了');
  console.log('\n[simulate] 次のコマンドを実行して通知を確認してください:');
  console.log(`  PRICE_THRESHOLD_YEN=${config.priceThresholdYen} PAGES=${config.pages.join(',')} node src/oneshot.js`);
  console.log('\n[simulate] 期待される通知:');
  if (simulatedPrevStock === 0 && targetProduct.totalStock > 0) {
    console.log('  - BackInStock (在庫0 → ' + targetProduct.totalStock + ')');
  } else if (targetProduct.totalStock > simulatedPrevStock) {
    console.log('  - StockIncreased (在庫' + simulatedPrevStock + ' → ' + targetProduct.totalStock + ')');
  }
  if (simulatedPrevPrice !== targetProduct.priceYen) {
    const delta = targetProduct.priceYen - simulatedPrevPrice;
    console.log('  - PriceChanged (¥' + simulatedPrevPrice.toLocaleString() + ' → ¥' + targetProduct.priceYen.toLocaleString() + ', ' + (delta > 0 ? '+' : '') + '¥' + delta.toLocaleString() + ')');
  }
  
  // Redis接続を閉じる
  const redis = getRedis();
  await redis.quit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

