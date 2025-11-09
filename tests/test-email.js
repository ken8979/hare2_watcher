import dotenv from 'dotenv';
dotenv.config();
import { sendEmail } from '../src/email.js';

async function main() {
  console.log('[test-email] メール通知テストを開始します...');
  console.log('[test-email] 設定確認:');
  console.log('  EMAIL_ENABLED:', process.env.EMAIL_ENABLED);
  console.log('  EMAIL_SMTP_HOST:', process.env.EMAIL_SMTP_HOST);
  console.log('  EMAIL_SMTP_PORT:', process.env.EMAIL_SMTP_PORT);
  console.log('  EMAIL_SMTP_USER:', process.env.EMAIL_SMTP_USER);
  console.log('  EMAIL_TO:', process.env.EMAIL_TO);
  
  const testSubject = '【テスト】晴れる屋2 在庫監視システム - メール通知テスト';
  const testMessage = `これはメール通知機能のテストメールです。

【StockIncreased】¥100,000 在庫1
テスト商品名
https://www.hareruya2.com/products/test
前回在庫: 0

このメールが届いていれば、メール通知機能は正常に動作しています。`;

  try {
    await sendEmail(testSubject, testMessage);
    console.log('[test-email] ✅ メール送信成功！');
    console.log('[test-email] 受信ボックス（および迷惑メールフォルダ）を確認してください。');
  } catch (error) {
    console.error('[test-email] ❌ メール送信失敗:', error.message);
    console.error('[test-email] エラー詳細:', error);
    
    if (error.message.includes('Invalid login')) {
      console.error('\n[test-email] Gmailのアプリパスワードが正しく設定されていない可能性があります。');
      console.error('[test-email] 設定方法:');
      console.error('  1. Googleアカウントの設定 > セキュリティ > 2段階認証プロセス を有効化');
      console.error('  2. アプリパスワードを生成: https://myaccount.google.com/apppasswords');
      console.error('  3. 生成された16文字のパスワードを .env の EMAIL_SMTP_PASSWORD に設定');
    }
  }
}

main().catch(console.error);

