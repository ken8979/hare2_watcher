import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';

async function main() {
  console.log('[test-collections-config] コレクション設定の確認テスト');
  console.log(`\n[test-collections-config] 設定されているコレクション数: ${config.collections.length}`);
  
  if (config.collections.length === 0) {
    console.error('[test-collections-config] ❌ コレクションが設定されていません');
    console.error('[test-collections-config] .envファイルにCOLLECTIONS環境変数を設定してください');
    process.exit(1);
  }
  
  console.log('\n[test-collections-config] コレクション一覧:');
  config.collections.forEach((col, index) => {
    console.log(`\n  ${index + 1}. ${col.name}`);
    console.log(`     URL: ${col.base}`);
    console.log(`     ページ: ${Array.isArray(col.pages) ? col.pages.length + 'ページ' : col.pages}`);
    console.log(`     優先度: ${col.priority}`);
    console.log(`     自動ページ検出: ${col.autoDetectPages ? '有効' : '無効'}`);
  });
  
  console.log('\n[test-collections-config] ✅ コレクション設定の確認完了');
}

main().catch(err => {
  console.error('[test-collections-config] エラー:', err);
  process.exit(1);
});

