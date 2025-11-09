import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage, detectMaxPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-multi-collections-fetch] 複数コレクション取得テスト');
  console.log(`\n[test-multi-collections-fetch] 設定されているコレクション数: ${config.collections.length}`);
  
  if (config.collections.length === 0) {
    console.error('[test-multi-collections-fetch] ❌ コレクションが設定されていません');
    console.error('[test-multi-collections-fetch] .envファイルにCOLLECTIONS環境変数を設定してください');
    process.exit(1);
  }
  
  // テスト対象のコレクションを選択（最大5件）
  const testCollections = config.collections.slice(0, 5);
  console.log(`\n[test-multi-collections-fetch] テスト対象コレクション: ${testCollections.length}件`);
  
  const results = [];
  
  for (const collection of testCollections) {
    console.log(`\n[test-multi-collections-fetch] ========================================`);
    console.log(`[test-multi-collections-fetch] コレクション: ${collection.name}`);
    console.log(`[test-multi-collections-fetch] URL: ${collection.base}`);
    console.log(`[test-multi-collections-fetch] 優先度: ${collection.priority}`);
    
    try {
      // 最大ページ数を検出
      console.log(`[test-multi-collections-fetch] 最大ページ数を検出中...`);
      const maxPage = await detectMaxPage(collection.base);
      const actualPages = maxPage || 1;
      console.log(`[test-multi-collections-fetch] 最大ページ数: ${actualPages}`);
      
      // 最初のページを取得（テスト用）
      const testPage = 1;
      console.log(`[test-multi-collections-fetch] ページ${testPage}を取得中...`);
      
      const result = await fetchCollectionPage(collection.base, testPage);
      console.log(`[test-multi-collections-fetch] 取得した商品数: ${result.products.length}件`);
      
      // 対象商品（価格閾値以上、在庫あり）をフィルタ
      const targetProducts = result.products.filter(p => isTargetProduct(p));
      console.log(`[test-multi-collections-fetch] 対象商品数（¥${config.priceThresholdYen.toLocaleString()}以上、在庫あり）: ${targetProducts.length}件`);
      
      // サンプル商品を表示（最大3件）
      if (targetProducts.length > 0) {
        console.log(`[test-multi-collections-fetch] サンプル商品:`);
        targetProducts.slice(0, 3).forEach((product, index) => {
          console.log(`  ${index + 1}. ${product.title.substring(0, 50)}...`);
          console.log(`     価格: ¥${product.priceYen.toLocaleString()}, 在庫: ${product.totalStock}`);
          console.log(`     URL: ${product.url}`);
        });
      } else {
        console.log(`[test-multi-collections-fetch] 対象商品なし`);
      }
      
      results.push({
        name: collection.name,
        success: true,
        totalProducts: result.products.length,
        targetProducts: targetProducts.length,
        maxPage: actualPages,
        sampleProducts: targetProducts.slice(0, 3),
      });
      
      // レート制限を守る
      await sleep(1000);
      
    } catch (error) {
      console.error(`[test-multi-collections-fetch] ❌ エラー: ${error.message}`);
      results.push({
        name: collection.name,
        success: false,
        error: error.message,
      });
    }
  }
  
  // 結果サマリー
  console.log(`\n[test-multi-collections-fetch] ========================================`);
  console.log(`[test-multi-collections-fetch] テスト結果サマリー`);
  console.log(`[test-multi-collections-fetch] ========================================`);
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log(`\n[test-multi-collections-fetch] 成功: ${successCount}件 / 失敗: ${failCount}件`);
  
  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.name}:`);
    if (result.success) {
      console.log(`   ✅ 成功`);
      console.log(`   総商品数: ${result.totalProducts}件`);
      console.log(`   対象商品数: ${result.targetProducts}件`);
      console.log(`   最大ページ数: ${result.maxPage}`);
    } else {
      console.log(`   ❌ 失敗: ${result.error}`);
    }
  });
  
  const totalTargetProducts = results
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.targetProducts, 0);
  
  console.log(`\n[test-multi-collections-fetch] 合計対象商品数: ${totalTargetProducts}件`);
  console.log(`[test-multi-collections-fetch] 価格閾値: ¥${config.priceThresholdYen.toLocaleString()}`);
  
  if (successCount === testCollections.length) {
    console.log(`\n[test-multi-collections-fetch] ✅ すべてのコレクションから正常に取得できました`);
  } else {
    console.log(`\n[test-multi-collections-fetch] ⚠️  一部のコレクションでエラーが発生しました`);
  }
  
  console.log(`\n[test-multi-collections-fetch] テスト完了`);
}

main().catch(err => {
  console.error('[test-multi-collections-fetch] エラー:', err);
  process.exit(1);
});

