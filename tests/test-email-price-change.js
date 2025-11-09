import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState } from '../src/redis.js';
import { sendBatchEmail } from '../src/email.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-email-price-change] 価格変動メール送信テストを開始します...');
  console.log('[test-email-price-change] 設定確認:');
  console.log('  EMAIL_ENABLED:', config.emailEnabled);
  console.log('  EMAIL_TO:', process.env.EMAIL_TO);
  console.log('  PRICE_THRESHOLD_YEN:', config.priceThresholdYen);
  
  if (!config.emailEnabled) {
    console.error('[test-email-price-change] ❌ メール通知が無効化されています');
    console.error('[test-email-price-change] .envファイルで EMAIL_ENABLED=true に設定してください');
    process.exit(1);
  }
  
  if (!process.env.EMAIL_TO) {
    console.error('[test-email-price-change] ❌ EMAIL_TOが設定されていません');
    process.exit(1);
  }
  
  // コレクションから実際の商品を1つ取得
  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-email-price-change] ❌ コレクションが設定されていません');
    process.exit(1);
  }
  
  console.log(`[test-email-price-change] 対象コレクション: ${collection.name}`);
  console.log(`[test-email-price-change] 商品を検索中...`);
  
  // 最初のページから商品を取得（リトライ付き）
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
        console.log(`[test-email-price-change] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }
  
  if (!products || products.length === 0) {
    console.error('[test-email-price-change] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }
  
  // 対象商品を複数探す（価格閾値以上、在庫あり）
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      // 最大5件まで取得（テスト用）
      if (targetProducts.length >= 5) {
        break;
      }
    }
  }
  
  if (targetProducts.length === 0) {
    console.error('[test-email-price-change] ❌ 対象商品（価格閾値以上、在庫あり）が見つかりませんでした');
    console.error(`[test-email-price-change] 価格閾値: ¥${config.priceThresholdYen.toLocaleString()}`);
    process.exit(1);
  }
  
  console.log(`\n[test-email-price-change] ${targetProducts.length}件の対象商品を発見:`);
  targetProducts.forEach((product, index) => {
    console.log(`  ${index + 1}. ${product.title}`);
    console.log(`     価格: ¥${product.priceYen.toLocaleString()}, 在庫: ${product.totalStock}`);
  });
  
  // 複数の商品に対して価格変動をシミュレート
  const notifications = [];
  
  for (const targetProduct of targetProducts) {
    // 商品のidentityを取得
    const hashNumber = targetProduct.hashNumber;
    let identity = targetProduct.handle || targetProduct.productId || targetProduct.url;
    if (hashNumber) {
      identity = `${targetProduct.handle || targetProduct.productId}::#${hashNumber}`;
    }
    
    // 現在の状態を取得
    const prev = await getProductState(identity);
    
    // 価格変動をシミュレート（ランダムに5,000円〜20,000円の変動）
    const priceChange = Math.floor(Math.random() * 15000) + 5000; // 5,000〜20,000円
    const simulatedPrevPrice = targetProduct.priceYen - priceChange;
    const simulatedPrevStock = targetProduct.totalStock;
    
    console.log(`\n[test-email-price-change] 商品: ${targetProduct.title.substring(0, 30)}...`);
    console.log(`  前回価格: ¥${simulatedPrevPrice.toLocaleString()} → 現在価格: ¥${targetProduct.priceYen.toLocaleString()}`);
    console.log(`  価格差: +¥${priceChange.toLocaleString()}`);
    
    // Redisに前回状態を設定
    await setProductState(identity, {
      lastTotalStock: simulatedPrevStock,
      lastEventType: 'PriceChanged',
      lastEventAt: new Date(Date.now() - 60000).toISOString(), // 1分前
      firstSeenAt: prev?.firstSeenAt || new Date().toISOString(),
      lastPriceYen: simulatedPrevPrice,
      lastHashNumber: hashNumber || '',
    });
    
    // 通知メッセージを作成（watch.jsと同じ形式）
    const msgParts = [
      `【PriceChanged】¥${targetProduct.priceYen.toLocaleString()} 在庫${targetProduct.totalStock}`,
      targetProduct.title,
      targetProduct.url,
      `前回在庫: ${simulatedPrevStock}`,
    ];
    
    const priceDelta = targetProduct.priceYen - simulatedPrevPrice;
    const deltaStr = priceDelta > 0 ? `+¥${priceDelta.toLocaleString()}` : `¥${priceDelta.toLocaleString()}`;
    msgParts.push(`前回価格: ¥${simulatedPrevPrice.toLocaleString()} → ${deltaStr}`);
    
    const message = msgParts.join('\n');
    
    notifications.push({
      eventType: 'PriceChanged',
      message: message,
      product: targetProduct,
      timestamp: new Date().toISOString(),
    });
  }
  
  console.log(`\n[test-email-price-change] ${notifications.length}件の通知を準備しました`);
  console.log('[test-email-price-change] Redisに前回状態を設定しました');
  
  // バッチメール送信をテスト
  console.log(`\n[test-email-price-change] バッチメール送信を開始... (${notifications.length}件をまとめて送信)`);
  
  try {
    await sendBatchEmail(collection.name, notifications);
    console.log('[test-email-price-change] ✅ メール送信成功！');
    console.log(`[test-email-price-change] ${process.env.EMAIL_TO} にメールが送信されました`);
    console.log(`[test-email-price-change] ${notifications.length}件の通知が1通のメールにまとめられています`);
    console.log('[test-email-price-change] 受信ボックス（および迷惑メールフォルダ）を確認してください。');
  } catch (error) {
    console.error('[test-email-price-change] ❌ メール送信失敗:', error.message);
    console.error('[test-email-price-change] エラー詳細:', error);
    process.exit(1);
  }
  
  // クリーンアップ: Redisの状態を元に戻す（オプション）
  console.log('\n[test-email-price-change] テスト完了');
  console.log('[test-email-price-change] 注意: Redisの状態は変更されたままです。必要に応じて手動でクリアしてください。');
}

main().catch(err => {
  console.error('[test-email-price-change] エラー:', err);
  process.exit(1);
});

