import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { sendBatchEmail } from '../src/email.js';

async function main() {
  console.log('[test-e2e-email] E2Eテスト: メール送信フォーマット確認');
  console.log('[test-e2e-email] 設定確認:');
  console.log('  EMAIL_ENABLED:', config.emailEnabled);
  console.log('  EMAIL_TO:', process.env.EMAIL_TO);
  
  if (!config.emailEnabled) {
    console.error('[test-e2e-email] ❌ メール通知が無効化されています');
    process.exit(1);
  }
  
  if (!process.env.EMAIL_TO) {
    console.error('[test-e2e-email] ❌ EMAIL_TOが設定されていません');
    process.exit(1);
  }
  
  // テスト用の通知データ（実際の形式に合わせて）
  const mockNotifications = [
    {
      eventType: 'StockIncreased',
      message: `【StockIncreased】¥450,000 在庫1
【状態C】パソコン大暴走！*光沢無し(R白影)(PROMO){トレーナー}〈-〉[PMCG-P]#1672
https://www.hareruya2.com/products/9745438966080
前回在庫: 0`,
      product: {
        title: '【状態C】パソコン大暴走！*光沢無し(R白影)(PROMO){トレーナー}〈-〉[PMCG-P]#1672',
        priceYen: 450000,
        totalStock: 1,
        url: 'https://www.hareruya2.com/products/9745438966080',
      },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'HighPriceInStock',
      message: `【HighPriceInStock】¥230,000 在庫1
エビワラー:初版(-){闘}〈-〉[OP00]
https://www.hareruya2.com/products/9013776220480
前回在庫: N/A`,
      product: {
        title: 'エビワラー:初版(-){闘}〈-〉[OP00]',
        priceYen: 230000,
        totalStock: 1,
        url: 'https://www.hareruya2.com/products/9013776220480',
      },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'BackInStock',
      message: `【BackInStock】¥90,000 在庫1
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
  ];
  
  console.log(`\n[test-e2e-email] ${mockNotifications.length}件のテスト通知を準備`);
  console.log('[test-e2e-email] 期待される動作:');
  console.log('  1. 区切り線（======や----）が表示されない');
  console.log('  2. 【HighPriceInStock】の行が表示されない');
  console.log('  3. 価格変更の情報が表示されない');
  console.log('  4. 商品間は1行空行のみ');
  
  // バッチメール送信をテスト
  console.log(`\n[test-e2e-email] バッチメール送信を開始...`);
  
  try {
    await sendBatchEmail('PMCG', mockNotifications);
    console.log('[test-e2e-email] ✅ メール送信成功！');
    console.log(`[test-e2e-email] ${process.env.EMAIL_TO} にメールが送信されました`);
    console.log('\n[test-e2e-email] メール内容の確認:');
    console.log('  - 区切り線（======や----）が含まれていないか確認');
    console.log('  - 【HighPriceInStock】の行が含まれていないか確認');
    console.log('  - 商品間は1行空行のみか確認');
    console.log('  - 価格変更の情報が含まれていないか確認');
  } catch (error) {
    console.error('[test-e2e-email] ❌ メール送信失敗:', error.message);
    console.error('[test-e2e-email] エラー詳細:', error);
    process.exit(1);
  }
  
  console.log('\n[test-e2e-email] E2Eテスト完了');
}

main().catch(err => {
  console.error('[test-e2e-email] エラー:', err);
  process.exit(1);
});

