import { config } from './config.js';

console.log('=== 設定確認テスト ===\n');

console.log('基本設定:');
console.log('  REDIS_URL:', config.redisUrl);
console.log('  SLACK_WEBHOOK_URL:', config.slackWebhookUrl ? '設定済み' : '未設定');
console.log('  PRICE_THRESHOLD_YEN:', config.priceThresholdYen);
console.log('  RPS_BUDGET:', config.rpsBudget);
console.log('  HOT_INTERVAL_SEC:', config.hotIntervalSec);
console.log('  WARM_INTERVAL_SEC:', config.warmIntervalSec);
console.log('  COLD_INTERVAL_SEC:', config.coldIntervalSec || '未設定');

console.log('\nコレクション設定:');
console.log('  コレクション数:', config.collections.length);
for (const col of config.collections) {
  console.log(`  - ${col.name}:`);
  console.log(`    ベースURL: ${col.base}`);
  console.log(`    ページ数: ${Array.isArray(col.pages) ? col.pages.length : 'auto'} (${col.pages === 'auto' ? '自動検出' : Array.isArray(col.pages) ? col.pages.slice(0, 5).join(',') + (col.pages.length > 5 ? '...' : '') : col.pages})`);
  console.log(`    優先度: ${col.priority}`);
  console.log(`    自動検出: ${col.autoDetectPages ? 'はい' : 'いいえ'}`);
}

console.log('\n後方互換性設定:');
console.log('  TARGET_COLLECTION_BASE:', config.targetCollectionBase);
console.log('  PAGES:', config.pages.join(','));

console.log('\n=== テスト完了 ===');

