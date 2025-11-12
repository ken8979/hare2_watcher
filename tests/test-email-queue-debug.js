import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, getRedis } from '../src/redis.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-email-queue-debug] メール通知キュー動作確認テスト');
  
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-email-queue-debug] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-email-queue-debug] 対象コレクション: ${collection.name}`);
  
  // メール通知キューをシミュレート
  const emailNotificationQueue = new Map();
  
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
        console.log(`[test-email-queue-debug] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-email-queue-debug] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  // 対象商品を探す
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 3) break;
    }
  }
  
  if (targetProducts.length === 0) {
    console.error('[test-email-queue-debug] ❌ 対象商品が見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`\n[test-email-queue-debug] ${targetProducts.length}件の商品を処理`);
  
  // 商品を処理してキューに追加（watch.jsと同じロジック）
  for (const product of targetProducts) {
    const collectionName = collection.name;
    
    // queueKeyの決定ロジックをテスト
    let queueKey = collectionName;
    if (!queueKey && product.url) {
      const urlMatch = product.url.match(/\/collections\/([^\/]+)/);
      if (urlMatch) {
        queueKey = urlMatch[1].toUpperCase();
      } else {
        queueKey = 'UNKNOWN';
      }
    }
    
    console.log(`\n[test-email-queue-debug] 商品: ${product.title.substring(0, 40)}...`);
    console.log(`  collectionName: ${collectionName}`);
    console.log(`  queueKey: ${queueKey}`);
    console.log(`  URL: ${product.url}`);
    
    if (queueKey) {
      if (!emailNotificationQueue.has(queueKey)) {
        emailNotificationQueue.set(queueKey, []);
      }
      emailNotificationQueue.get(queueKey).push({
        eventType: 'StockIncreased',
        message: `テストメッセージ: ${product.title}`,
        product,
        timestamp: new Date().toISOString(),
      });
      console.log(`  ✅ キューに追加: ${queueKey}`);
    } else {
      console.log(`  ❌ キューに追加失敗: queueKeyが不明`);
    }
  }
  
  // キュー状態を確認
  console.log(`\n[test-email-queue-debug] ========================================`);
  console.log(`[test-email-queue-debug] キュー状態確認`);
  console.log(`[test-email-queue-debug] ========================================`);
  
  for (const [key, notifications] of emailNotificationQueue.entries()) {
    console.log(`\nキュー: ${key}`);
    console.log(`  通知数: ${notifications.length}件`);
    console.log(`  コレクション名との一致: ${key === collection.name ? '✅ 一致' : '❌ 不一致'}`);
  }
  
  // コレクション処理完了後のメール送信ロジックをシミュレート
  console.log(`\n[test-email-queue-debug] ========================================`);
  console.log(`[test-email-queue-debug] コレクション処理完了後のメール送信シミュレーション`);
  console.log(`[test-email-queue-debug] ========================================`);
  
  const collectionNotifications = emailNotificationQueue.get(collection.name);
  if (collectionNotifications && collectionNotifications.length > 0) {
    console.log(`✅ ${collection.name} のキューに ${collectionNotifications.length}件の通知があります`);
    console.log(`   メール送信が実行されます`);
  } else {
    console.log(`❌ ${collection.name} のキューに通知がありません`);
    console.log(`   利用可能なキュー: ${Array.from(emailNotificationQueue.keys()).join(', ')}`);
    console.log(`   問題: キューキーが collection.name と一致していない可能性があります`);
  }
  
  await getRedis().quit();
  console.log('\n[test-email-queue-debug] テスト完了');
}

main().catch(err => {
  console.error('[test-email-queue-debug] エラー:', err);
  process.exit(1);
});

