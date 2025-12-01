import dotenv from 'dotenv';
dotenv.config();

import { config } from '../src/config.js';
import { sendEmail, sendBatchEmail } from '../src/email.js';

async function main() {
  console.log('========================================');
  console.log('[test-email] メール送信テスト開始');
  console.log('========================================\n');
  
  // 設定確認
  console.log('[test-email] 現在の設定:');
  console.log(`  EMAIL_ENABLED: ${config.emailEnabled}`);
  console.log(`  EMAIL_SMTP_HOST: ${config.emailSmtpHost}`);
  console.log(`  EMAIL_SMTP_PORT: ${config.emailSmtpPort}`);
  console.log(`  EMAIL_SMTP_SECURE: ${config.emailSmtpSecure}`);
  console.log(`  EMAIL_SMTP_USER: ${config.emailSmtpUser || '(未設定)'}`);
  console.log(`  EMAIL_SMTP_PASSWORD: ${config.emailSmtpPassword ? '*****(設定済み)' : '(未設定)'}`);
  console.log(`  EMAIL_FROM: ${config.emailFrom || '(未設定)'}`);
  console.log(`  EMAIL_TO: ${Array.isArray(config.emailTo) && config.emailTo.length > 0 ? config.emailTo.join(', ') : '(未設定)'}`);
  console.log('');
  
  // 設定チェック
  const errors = [];
  if (!config.emailEnabled) {
    errors.push('EMAIL_ENABLED=true に設定してください');
  }
  if (!config.emailSmtpUser) {
    errors.push('EMAIL_SMTP_USER を設定してください');
  }
  if (!config.emailSmtpPassword) {
    errors.push('EMAIL_SMTP_PASSWORD を設定してください');
  }
  if (!config.emailTo || config.emailTo.length === 0) {
    errors.push('EMAIL_TO を設定してください（カンマ区切りで複数指定可能）');
  }
  
  if (errors.length > 0) {
    console.error('[test-email] ❌ 設定エラー:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error('\n.env ファイルを確認してください。');
    process.exit(1);
  }
  
  console.log('[test-email] ✅ 設定チェック完了\n');
  
  // テスト1: 単純なメール送信
  console.log('----------------------------------------');
  console.log('[test-email] テスト1: 単純なメール送信');
  console.log('----------------------------------------');
  try {
    await sendEmail(
      '[テスト] Hare2 メール送信テスト',
      `これはHare2のメール送信テストです。

送信時刻: ${new Date().toLocaleString('ja-JP')}
送信先: ${config.emailTo.join(', ')}

このメールが届いていれば、メール送信機能は正常に動作しています。`
    );
    console.log('[test-email] ✅ テスト1成功\n');
  } catch (error) {
    console.error('[test-email] ❌ テスト1失敗:', error.message);
    console.error('[test-email] エラー詳細:', error);
    process.exit(1);
  }
  
  // 2秒待機
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // テスト2: 在庫追加通知（StockIncreased）
  console.log('----------------------------------------');
  console.log('[test-email] テスト2: 在庫追加通知（StockIncreased）');
  console.log('----------------------------------------');
  try {
    const stockNotifications = [
      {
        eventType: 'StockIncreased',
        message: `テスト商品A（在庫増加テスト）
https://www.hareruya2.com/products/test-product-a
¥50,000
在庫: 0 → 2`,
        product: {
          title: 'テスト商品A（在庫増加テスト）',
          url: 'https://www.hareruya2.com/products/test-product-a',
          priceYen: 50000,
          totalStock: 2,
        },
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'BackInStock',
        message: `テスト商品B（再入荷テスト）
https://www.hareruya2.com/products/test-product-b
¥30,000
在庫: 0 → 1`,
        product: {
          title: 'テスト商品B（再入荷テスト）',
          url: 'https://www.hareruya2.com/products/test-product-b',
          priceYen: 30000,
          totalStock: 1,
        },
        timestamp: new Date().toISOString(),
      },
    ];
    
    await sendBatchEmail('PMCG', stockNotifications);
    console.log('[test-email] ✅ テスト2成功\n');
  } catch (error) {
    console.error('[test-email] ❌ テスト2失敗:', error.message);
    process.exit(1);
  }
  
  // 2秒待機
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // テスト3: #付きカード追加通知（NewHighPricePage）
  console.log('----------------------------------------');
  console.log('[test-email] テスト3: #付きカード追加通知（NewHighPricePage）');
  console.log('----------------------------------------');
  try {
    const newCardNotification = [
      {
        eventType: 'NewHighPricePage',
        message: `【超高額】ポケモンカード #1234 テストカード
https://www.hareruya2.com/products/test-card-1234
¥100,000
在庫: N/A → 1`,
        product: {
          title: '【超高額】ポケモンカード #1234 テストカード',
          url: 'https://www.hareruya2.com/products/test-card-1234',
          priceYen: 100000,
          totalStock: 1,
          hashNumber: '1234',
        },
        timestamp: new Date().toISOString(),
      },
    ];
    
    await sendBatchEmail('PMCG', newCardNotification);
    console.log('[test-email] ✅ テスト3成功\n');
  } catch (error) {
    console.error('[test-email] ❌ テスト3失敗:', error.message);
    process.exit(1);
  }
  
  console.log('========================================');
  console.log('[test-email] ✅ すべてのテストが成功しました！');
  console.log('========================================\n');
  console.log('送信されたメール:');
  console.log('  1. 単純なテストメール');
  console.log('  2. 在庫追加通知（件名: 【PMCG】在庫・価格変動通知 (2件)）');
  console.log('  3. #付きカード追加通知（件名: #1234在庫追加）');
  console.log('');
  console.log(`送信先: ${config.emailTo.join(', ')}`);
  console.log('');
  console.log('受信ボックス（および迷惑メールフォルダ）を確認してください。');
}

main().catch(err => {
  console.error('[test-email] エラー:', err);
  process.exit(1);
});

