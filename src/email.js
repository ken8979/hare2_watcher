import nodemailer from 'nodemailer';
import { config } from './config.js';

let transporter = null;

function getTransporter() {
  if (!transporter && config.emailEnabled) {
    transporter = nodemailer.createTransport({
      host: config.emailSmtpHost,
      port: config.emailSmtpPort,
      secure: config.emailSmtpSecure, // true for 465, false for other ports
      auth: {
        user: config.emailSmtpUser,
        pass: config.emailSmtpPassword,
      },
    });
  }
  return transporter;
}

export async function sendEmail(subject, message) {
  if (!config.emailEnabled || !config.emailTo || config.emailTo.length === 0) {
    console.log('[email] メール通知は無効化されています');
    return;
  }

  const mailOptions = {
    from: config.emailFrom || config.emailSmtpUser,
    to: config.emailTo, // 配列または文字列（nodemailerは両方受け付ける）
    subject: subject,
    text: message,
  };

  try {
    const transport = getTransporter();
    if (!transport) {
      throw new Error('メール送信設定が不完全です');
    }
    const info = await transport.sendMail(mailOptions);
    console.log('[email] メール送信成功');
    console.log('[email] 件名:', subject);
    console.log('[email] 送信先:', Array.isArray(config.emailTo) ? config.emailTo.join(', ') : config.emailTo);
    console.log('[email] メッセージID:', info.messageId);
  } catch (error) {
    console.error('[email] メール送信失敗:', error.message);
    throw error;
  }
}

// バッチメール送信（複数の通知をまとめて送信）
export async function sendBatchEmail(collectionName, notifications) {
  if (!config.emailEnabled || !config.emailTo || config.emailTo.length === 0 || !notifications || notifications.length === 0) {
    return;
  }

  // NewHighPricePageの場合は特別な件名を生成
  let subject;
  if (notifications.length === 1 && notifications[0].eventType === 'NewHighPricePage') {
    const hashNumber = notifications[0].product?.hashNumber || '';
    subject = `#${hashNumber}在庫追加`;
  } else {
    subject = `【${collectionName}】在庫・価格変動通知 (${notifications.length}件)`;
  }
  
  const lines = [
    `【${collectionName}】の在庫・価格変動通知`,
    `変動件数: ${notifications.length}件`,
    '',
  ];

  for (const notif of notifications) {
    // メッセージから余分な空白行を削除し、最初の行（【イベントタイプ】価格 在庫）を削除
    const messageLines = notif.message
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0); // 空行を削除
    
    // 最初の行が【イベントタイプ】¥価格 在庫数の形式なら削除
    // （watch.jsでHighPriceInStockの場合は既に追加されていないが、念のため削除）
    if (messageLines.length > 0 && messageLines[0].match(/^【.+】¥[\d,]+ 在庫\d+$/)) {
      messageLines.shift(); // 最初の行を削除
    }
    
    const cleanMessage = messageLines.join('\n');
    if (cleanMessage) {
      lines.push(cleanMessage);
      lines.push(''); // 商品間は1行空行のみ
    }
  }

  // 最終的なメッセージから連続する空行を削除（最大2つの連続改行まで）
  const message = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // 3つ以上の連続する改行を2つに
    .trim();

  try {
    await sendEmail(subject, message);
    console.log(`[email] バッチメール送信成功: ${collectionName} (${notifications.length}件)`);
  } catch (error) {
    console.error(`[email] バッチメール送信失敗: ${collectionName}`, error.message);
  }
}

