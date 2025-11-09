// このテストは環境変数COLLECTIONSを設定して実行してください
// 例: COLLECTIONS='[{"name":"PMCG","base":"...","pages":[1,2,3],"priority":"hot"}]' node tests/test-multi-collection.js

import { config } from '../src/config.js';

console.log('=== 複数コレクション設定テスト ===\n');

console.log('コレクション数:', config.collections.length);
for (const col of config.collections) {
  console.log(`\n- ${col.name}:`);
  console.log(`  ベースURL: ${col.base}`);
  console.log(`  ページ: ${Array.isArray(col.pages) ? col.pages.join(',') : col.pages}`);
  console.log(`  優先度: ${col.priority}`);
}

console.log('\n=== テスト完了 ===');

