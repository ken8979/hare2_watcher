import { detectMaxPage } from '../src/collection.js';
import { config } from '../src/config.js';

console.log('=== 動的ページ数検出テスト ===\n');

const testCollection = config.collections[0];
console.log(`テストコレクション: ${testCollection.name}`);
console.log(`ベースURL: ${testCollection.base}\n`);

console.log('最大ページ数を検出中...');
try {
  const maxPage = await detectMaxPage(testCollection.base);
  if (maxPage) {
    console.log(`✅ 検出成功: 最大ページ数 = ${maxPage}`);
  } else {
    console.log('⚠️  検出失敗（ページネーションが見つかりませんでした）');
  }
} catch (err) {
  console.error('❌ エラー:', err.message);
}

console.log('\n=== テスト完了 ===');

