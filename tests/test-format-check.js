import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { sendBatchEmail } from '../src/email.js';

async function main() {
  console.log('[format-check] メールフォーマット確認テスト');
  
  // テスト用の通知データ
  const testNotifications = [
    {
      eventType: 'HighPriceInStock',
      message: `【HighPriceInStock】¥450,000 在庫1
商品名1
https://example.com/product1
前回在庫: N/A`,
      product: { title: '商品名1', priceYen: 450000, totalStock: 1 },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'StockIncreased',
      message: `【StockIncreased】¥230,000 在庫2
商品名2
https://example.com/product2
前回在庫: 1`,
      product: { title: '商品名2', priceYen: 230000, totalStock: 2 },
      timestamp: new Date().toISOString(),
    },
    {
      eventType: 'BackInStock',
      message: `【BackInStock】¥90,000 在庫1
商品名3
https://example.com/product3
前回在庫: 0`,
      product: { title: '商品名3', priceYen: 90000, totalStock: 1 },
      timestamp: new Date().toISOString(),
    },
  ];
  
  // メール送信処理をシミュレートしてフォーマットを確認
  const collectionName = 'PMCG';
  const subject = `【${collectionName}】在庫・価格変動通知 (${testNotifications.length}件)`;
  
  const lines = [
    `【${collectionName}】の在庫・価格変動通知`,
    `変動件数: ${testNotifications.length}件`,
    '',
  ];

  for (const notif of testNotifications) {
    const messageLines = notif.message
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    // 最初の行が【イベントタイプ】¥価格 在庫数の形式なら削除
    if (messageLines.length > 0 && messageLines[0].match(/^【.+】¥[\d,]+ 在庫\d+$/)) {
      messageLines.shift();
    }
    
    const cleanMessage = messageLines.join('\n');
    if (cleanMessage) {
      lines.push(cleanMessage);
      lines.push('');
    }
  }

  const message = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  console.log('\n=== 生成されたメール本文 ===');
  console.log(message);
  console.log('\n=== 確認項目 ===');
  
  // チェック1: 区切り線が含まれていないか
  const hasEquals = message.includes('='.repeat(10));
  const hasDashes = message.includes('-'.repeat(10));
  console.log(`1. 区切り線（======や----）が含まれていない: ${!hasEquals && !hasDashes ? '✅' : '❌'}`);
  
  // チェック2: HighPriceInStockの行が含まれていないか
  const hasHighPriceLine = message.includes('【HighPriceInStock】');
  console.log(`2. 【HighPriceInStock】の行が含まれていない: ${!hasHighPriceLine ? '✅' : '❌'}`);
  
  // チェック3: 価格変更の情報が含まれていないか
  const hasPriceChange = message.includes('前回価格:') && message.includes('→');
  console.log(`3. 価格変更の情報が含まれていない: ${!hasPriceChange ? '✅' : '❌'}`);
  
  // チェック4: 商品間の空行が1行のみか
  const doubleNewlines = (message.match(/\n\n/g) || []).length;
  const tripleNewlines = (message.match(/\n\n\n/g) || []).length;
  console.log(`4. 連続する改行が適切（3つ以上ない）: ${tripleNewlines === 0 ? '✅' : '❌'}`);
  
  console.log('\n=== 期待されるメール形式 ===');
  console.log('【PMCG】の在庫・価格変動通知');
  console.log('変動件数: 3件');
  console.log('');
  console.log('商品名1');
  console.log('https://example.com/product1');
  console.log('前回在庫: N/A');
  console.log('');
  console.log('商品名2');
  console.log('https://example.com/product2');
  console.log('前回在庫: 1');
  console.log('');
  console.log('商品名3');
  console.log('https://example.com/product3');
  console.log('前回在庫: 0');
  
  // 実際にメール送信（オプション）
  if (config.emailEnabled && process.env.EMAIL_TO) {
    console.log('\n実際のメール送信を実行しますか？ (y/n)');
    // 自動で実行
    try {
      await sendBatchEmail(collectionName, testNotifications);
      console.log('✅ メール送信成功！');
    } catch (error) {
      console.error('❌ メール送信失敗:', error.message);
    }
  }
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});

