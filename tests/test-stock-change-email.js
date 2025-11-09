import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, getRedis } from '../src/redis.js';
import { sendBatchEmail } from '../src/email.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-stock-change-email] 在庫変動メール送信テスト');
  console.log('[test-stock-change-email] 期待される動作: 複数の商品の在庫変動を1通のメールにまとめて送信');
  
  console.log('[test-stock-change-email] 設定確認:');
  console.log('  EMAIL_ENABLED:', config.emailEnabled);
  console.log('  EMAIL_TO:', process.env.EMAIL_TO);
  console.log('  PRICE_THRESHOLD_YEN:', config.priceThresholdYen);

  if (!config.emailEnabled) {
    console.error('[test-stock-change-email] ❌ メール通知が無効化されています');
    console.error('[test-stock-change-email] .envファイルで EMAIL_ENABLED=true に設定してください');
    process.exit(1);
  }

  if (!process.env.EMAIL_TO) {
    console.error('[test-stock-change-email] ❌ EMAIL_TOが設定されていません');
    process.exit(1);
  }

  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-stock-change-email] ❌ コレクションが設定されていません');
    process.exit(1);
  }

  console.log(`\n[test-stock-change-email] 対象コレクション: ${collection.name}`);
  console.log(`[test-stock-change-email] 商品を検索中...`);

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
        console.log(`[test-stock-change-email] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }

  if (!products || products.length === 0) {
    console.error('[test-stock-change-email] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }

  // 対象商品を探す（最大5件）
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 5) break;
    }
  }

  if (targetProducts.length === 0) {
    console.error('[test-stock-change-email] ❌ 対象商品（価格閾値以上、在庫あり）が見つかりませんでした');
    console.error(`[test-stock-change-email] 価格閾値: ¥${config.priceThresholdYen.toLocaleString()}`);
    process.exit(1);
  }

  console.log(`\n[test-stock-change-email] ${targetProducts.length}件の対象商品を発見:`);
  targetProducts.forEach((product, index) => {
    console.log(`  ${index + 1}. ${product.title.substring(0, 40)}...`);
    console.log(`     価格: ¥${product.priceYen.toLocaleString()}, 在庫: ${product.totalStock}`);
  });

  const notifications = [];
  const redis = getRedis();

  console.log(`\n[test-stock-change-email] 在庫変動をシミュレート中...`);

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

    // 異なる在庫変動パターンをシミュレート
    let simulatedPrevStock = null;
    let eventType = null;
    
    if (i === 0) {
      // 1件目: 再入荷（在庫0→1）
      simulatedPrevStock = 0;
      eventType = 'BackInStock';
    } else if (i === 1) {
      // 2件目: 在庫増加（在庫1→2以上）
      // 現在在庫が1の場合は、前回を0にして再入荷として扱う
      simulatedPrevStock = 0;
      eventType = 'BackInStock';
    } else if (i === 2) {
      // 3件目: 再入荷（在庫0→1）
      simulatedPrevStock = 0;
      eventType = 'BackInStock';
    } else if (i === 3) {
      // 4件目: 再入荷（在庫0→1）
      simulatedPrevStock = 0;
      eventType = 'BackInStock';
    } else {
      // 5件目: 再入荷（在庫0→1）
      simulatedPrevStock = 0;
      eventType = 'BackInStock';
    }

    const simulatedPrevPrice = product.priceYen; // 価格は変更しない

    console.log(`\n[test-stock-change-email] 商品 ${i + 1}: ${product.title.substring(0, 30)}...`);
    console.log(`  前回在庫: ${simulatedPrevStock} → 現在在庫: ${product.totalStock}`);
    console.log(`  イベントタイプ: ${eventType}`);

    // Redisに前回状態を設定
    await setProductState(identity, {
      lastTotalStock: simulatedPrevStock,
      lastEventType: eventType,
      lastEventAt: new Date(Date.now() - 60000).toISOString(), // 1分前
      firstSeenAt: new Date(Date.now() - 3600000).toISOString(), // 1時間前
      lastPriceYen: simulatedPrevPrice,
      lastHashNumber: hashNumber || '',
    });

    // 通知メッセージを作成（watch.jsと同じフォーマット）
    const cleanTitle = (product.title || '').replace(/\s+/g, ' ').trim();
    const msgParts = [];

    // 【HighPriceInStock】の行は追加しない
    if (eventType !== 'HighPriceInStock') {
      msgParts.push(`【${eventType}】¥${product.priceYen.toLocaleString()} 在庫${product.totalStock}`);
    }

    msgParts.push(cleanTitle);
    msgParts.push(product.url);
    msgParts.push(`在庫: ${simulatedPrevStock} → ${product.totalStock}`);

    const message = msgParts.join('\n');

    notifications.push({
      eventType: eventType,
      message: message,
      product: product,
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`\n[test-stock-change-email] ${notifications.length}件の通知を準備しました`);
  console.log('[test-stock-change-email] Redisに前回状態を設定しました');

  console.log(`\n[test-stock-change-email] 通知内容のプレビュー:`);
  notifications.forEach((notif, index) => {
    console.log(`\n--- 通知 ${index + 1} ---`);
    console.log(notif.message);
  });

  console.log(`\n[test-stock-change-email] バッチメール送信を開始... (${notifications.length}件をまとめて送信)`);

  try {
    await sendBatchEmail(collection.name, notifications);
    console.log('[test-stock-change-email] ✅ メール送信成功！');
    console.log(`[test-stock-change-email] ${process.env.EMAIL_TO} にメールが送信されました`);
    console.log(`[test-stock-change-email] ${notifications.length}件の通知が1通のメールにまとめられています`);
    console.log('[test-stock-change-email] 受信ボックス（および迷惑メールフォルダ）を確認してください。');
  } catch (error) {
    console.error('[test-stock-change-email] ❌ メール送信失敗:', error.message);
    console.error('[test-stock-change-email] エラー詳細:', error);
    process.exit(1);
  }

  console.log('\n[test-stock-change-email] テスト完了');
  console.log('[test-stock-change-email] 注意: Redisの状態は変更されたままです。必要に応じて手動でクリアしてください。');

  await redis.quit();
}

main().catch(err => {
  console.error('[test-stock-change-email] エラー:', err);
  process.exit(1);
});

