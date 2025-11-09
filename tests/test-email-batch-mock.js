import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { sendBatchEmail } from '../src/email.js';

async function main() {
  console.log('[test-email-batch-mock] バッチメール送信テスト（モックデータ）を開始します...');
  console.log('[test-email-batch-mock] 設定確認:');
  console.log('  EMAIL_ENABLED:', config.emailEnabled);
  console.log('  EMAIL_TO:', process.env.EMAIL_TO);
  
  if (!config.emailEnabled) {
    console.error('[test-email-batch-mock] ❌ メール通知が無効化されています');
    console.error('[test-email-batch-mock] .envファイルで EMAIL_ENABLED=true に設定してください');
    process.exit(1);
  }
  
  if (!process.env.EMAIL_TO) {
    console.error('[test-email-batch-mock] ❌ EMAIL_TOが設定されていません');
    process.exit(1);
  }
  
  // モックデータで複数の通知を作成
  const mockNotifications = [
    {
      eventType: 'PriceChanged',
      message: `【PriceChanged】¥450,000 在庫1
【状態C】パソコン大暴走！*光沢無し(R白影)(PROMO){トレーナー}〈-〉[PMCG-P]#1672
https://www.hareruya2.com/products/9745438966080
前回在庫: 1
前回価格: ¥445,000 → +¥5,000`,
      product: {
        title: '【状態C】パソコン大暴走！*光沢無し(R白影)(PROMO){トレーナー}〈-〉[PMCG-P]#1672',
        priceYen: 450000,
        totalStock: 1,
        url: 'https://www.hareruya2.com/products/9745438966080',
      },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'PriceChanged',
      message: `【PriceChanged】¥230,000 在庫1
エビワラー:初版(-){闘}〈-〉[OP00]
https://www.hareruya2.com/products/9013776220480
前回在庫: 1
前回価格: ¥225,000 → +¥5,000`,
      product: {
        title: 'エビワラー:初版(-){闘}〈-〉[OP00]',
        priceYen: 230000,
        totalStock: 1,
        url: 'https://www.hareruya2.com/products/9013776220480',
      },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'StockIncreased',
      message: `【StockIncreased】¥90,000 在庫1
わるいリザードン(R){炎}〈-〉[OP4]
https://www.hareruya2.com/products/9013771338048
前回在庫: 0`,
      product: {
        title: 'わるいリザードン(R){炎}〈-〉[OP4]',
        priceYen: 90000,
        totalStock: 1,
        url: 'https://www.hareruya2.com/products/9013771338048',
      },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'PriceChanged',
      message: `【PriceChanged】¥28,000 在庫1
シャワーズ(R){水}〈-〉[OP2]
https://www.hareruya2.com/products/9013775466816
前回在庫: 1
前回価格: ¥25,000 → +¥3,000`,
      product: {
        title: 'シャワーズ(R){水}〈-〉[OP2]',
        priceYen: 28000,
        totalStock: 1,
        url: 'https://www.hareruya2.com/products/9013775466816',
      },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'BackInStock',
      message: `【BackInStock】¥150,000 在庫2
ピカチュウ:初版(-){雷}〈-〉[OP00]
https://www.hareruya2.com/products/9013771234567
前回在庫: 0`,
      product: {
        title: 'ピカチュウ:初版(-){雷}〈-〉[OP00]',
        priceYen: 150000,
        totalStock: 2,
        url: 'https://www.hareruya2.com/products/9013771234567',
      },
      timestamp: new Date().toISOString(),
    },
  ];
  
  console.log(`\n[test-email-batch-mock] ${mockNotifications.length}件のモック通知を準備しました`);
  mockNotifications.forEach((notif, index) => {
    console.log(`  ${index + 1}. ${notif.eventType}: ${notif.product.title.substring(0, 30)}...`);
  });
  
  // バッチメール送信をテスト
  console.log(`\n[test-email-batch-mock] バッチメール送信を開始... (${mockNotifications.length}件をまとめて送信)`);
  
  try {
    await sendBatchEmail('PMCG', mockNotifications);
    console.log('[test-email-batch-mock] ✅ メール送信成功！');
    console.log(`[test-email-batch-mock] ${process.env.EMAIL_TO} にメールが送信されました`);
    console.log(`[test-email-batch-mock] ${mockNotifications.length}件の通知が1通のメールにまとめられています`);
    console.log('[test-email-batch-mock] 受信ボックス（および迷惑メールフォルダ）を確認してください。');
  } catch (error) {
    console.error('[test-email-batch-mock] ❌ メール送信失敗:', error.message);
    console.error('[test-email-batch-mock] エラー詳細:', error);
    process.exit(1);
  }
  
  console.log('\n[test-email-batch-mock] テスト完了');
}

main().catch(err => {
  console.error('[test-email-batch-mock] エラー:', err);
  process.exit(1);
});

