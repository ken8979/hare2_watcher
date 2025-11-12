import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { sendEmail, sendBatchEmail } from '../src/email.js';

async function main() {
  console.log('[test-email-simple] メール送信テスト開始');
  console.log('[test-email-simple] ========================================');
  
  // 設定確認
  console.log('[test-email-simple] 設定確認:');
  console.log(`  EMAIL_ENABLED: ${config.emailEnabled}`);
  console.log(`  EMAIL_SMTP_HOST: ${config.emailSmtpHost}`);
  console.log(`  EMAIL_SMTP_PORT: ${config.emailSmtpPort}`);
  console.log(`  EMAIL_SMTP_USER: ${config.emailSmtpUser}`);
  console.log(`  EMAIL_FROM: ${config.emailFrom || '(未設定)'}`);
  console.log(`  EMAIL_TO: ${config.emailTo || '(未設定)'}`);
  console.log('[test-email-simple] ========================================\n');
  
  if (!config.emailEnabled) {
    console.error('[test-email-simple] ❌ メール通知が無効化されています');
    console.error('[test-email-simple] .envファイルで EMAIL_ENABLED=true に設定してください');
    process.exit(1);
  }
  
  if (!config.emailTo) {
    console.error('[test-email-simple] ❌ EMAIL_TOが設定されていません');
    console.error('[test-email-simple] .envファイルで EMAIL_TO=your-email@example.com に設定してください');
    process.exit(1);
  }
  
  if (!config.emailSmtpUser || !config.emailSmtpPassword) {
    console.error('[test-email-simple] ❌ SMTP認証情報が設定されていません');
    console.error('[test-email-simple] .envファイルで EMAIL_SMTP_USER と EMAIL_SMTP_PASSWORD を設定してください');
    process.exit(1);
  }
  
  console.log('[test-email-simple] ✅ 設定は正常です\n');
  
  // テスト1: 単純なメール送信
  console.log('[test-email-simple] テスト1: 単純なメール送信');
  console.log('[test-email-simple] ----------------------------------------');
  try {
    const testSubject = '[テスト] Hare2 メール送信テスト';
    const testMessage = `これはテストメールです。

送信時刻: ${new Date().toLocaleString('ja-JP')}
送信元: ${config.emailSmtpUser}
送信先: ${config.emailTo}

このメールが届いていれば、メール送信機能は正常に動作しています。`;
    
    console.log('[test-email-simple] メール送信中...');
    await sendEmail(testSubject, testMessage);
    console.log('[test-email-simple] ✅ テスト1成功: メールが送信されました\n');
  } catch (error) {
    console.error('[test-email-simple] ❌ テスト1失敗:', error.message);
    console.error('[test-email-simple] エラー詳細:', error);
    process.exit(1);
  }
  
  // 少し待機
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // テスト2: バッチメール送信（通常の在庫変動通知）
  console.log('[test-email-simple] テスト2: バッチメール送信（通常の在庫変動通知）');
  console.log('[test-email-simple] ----------------------------------------');
  try {
    const mockNotifications = [
      {
        eventType: 'StockIncreased',
        message: `【StockIncreased】¥50,000 在庫1
テスト商品1
https://www.hareruya2.com/products/test1
在庫: 0 → 1`,
        product: {
          title: 'テスト商品1',
          url: 'https://www.hareruya2.com/products/test1',
          priceYen: 50000,
          totalStock: 1,
        },
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'BackInStock',
        message: `【BackInStock】¥30,000 在庫1
テスト商品2
https://www.hareruya2.com/products/test2
在庫: 0 → 1`,
        product: {
          title: 'テスト商品2',
          url: 'https://www.hareruya2.com/products/test2',
          priceYen: 30000,
          totalStock: 1,
        },
        timestamp: new Date().toISOString(),
      },
    ];
    
    console.log('[test-email-simple] バッチメール送信中...');
    await sendBatchEmail('TEST', mockNotifications);
    console.log('[test-email-simple] ✅ テスト2成功: バッチメールが送信されました\n');
  } catch (error) {
    console.error('[test-email-simple] ❌ テスト2失敗:', error.message);
    console.error('[test-email-simple] エラー詳細:', error);
    process.exit(1);
  }
  
  // 少し待機
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // テスト3: NewHighPricePageの即時メール送信
  console.log('[test-email-simple] テスト3: NewHighPricePageの即時メール送信');
  console.log('[test-email-simple] ----------------------------------------');
  try {
    const newHighPriceNotification = [
      {
        eventType: 'NewHighPricePage',
        message: `【NewHighPricePage】¥100,000 在庫1
テスト商品 #1929
https://www.hareruya2.com/products/test1929
在庫: N/A → 1`,
        product: {
          title: 'テスト商品 #1929',
          url: 'https://www.hareruya2.com/products/test1929',
          priceYen: 100000,
          totalStock: 1,
          hashNumber: '1929',
        },
        timestamp: new Date().toISOString(),
      },
    ];
    
    console.log('[test-email-simple] NewHighPricePageメール送信中...');
    await sendBatchEmail('TEST', newHighPriceNotification);
    console.log('[test-email-simple] ✅ テスト3成功: NewHighPricePageメールが送信されました\n');
  } catch (error) {
    console.error('[test-email-simple] ❌ テスト3失敗:', error.message);
    console.error('[test-email-simple] エラー詳細:', error);
    process.exit(1);
  }
  
  console.log('[test-email-simple] ========================================');
  console.log('[test-email-simple] ✅ すべてのテストが成功しました！');
  console.log('[test-email-simple] ========================================');
  console.log(`\n[test-email-simple] ${config.emailTo} に3通のメールが送信されました。`);
  console.log('[test-email-simple] 受信ボックス（および迷惑メールフォルダ）を確認してください。\n');
  console.log('[test-email-simple] 送信されたメール:');
  console.log('  1. 単純なメール送信テスト');
  console.log('  2. バッチメール（在庫変動通知）');
  console.log('  3. NewHighPricePageメール（件名: #1929在庫追加）');
}

main().catch(err => {
  console.error('[test-email-simple] エラー:', err);
  process.exit(1);
});

