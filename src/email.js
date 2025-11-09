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
  if (!config.emailEnabled || !config.emailTo) {
    console.log('[email] メール通知は無効化されています');
    return;
  }

  const mailOptions = {
    from: config.emailFrom || config.emailSmtpUser,
    to: config.emailTo,
    subject: subject,
    text: message,
  };

  try {
    const transport = getTransporter();
    if (!transport) {
      throw new Error('メール送信設定が不完全です');
    }
    const info = await transport.sendMail(mailOptions);
    console.log('[email] メール送信成功:', info.messageId);
  } catch (error) {
    console.error('[email] メール送信失敗:', error.message);
    throw error;
  }
}

// バッチメール送信（複数の通知をまとめて送信）
export async function sendBatchEmail(collectionName, notifications) {
  if (!config.emailEnabled || !config.emailTo || !notifications || notifications.length === 0) {
    return;
  }

  const subject = `【${collectionName}】在庫・価格変動通知 (${notifications.length}件)`;
  
  const lines = [
    `【${collectionName}】の在庫・価格変動通知`,
    `変動件数: ${notifications.length}件`,
    '',
    '='.repeat(50),
    '',
  ];

  for (const notif of notifications) {
    // メッセージから余分な空白行を削除
    const cleanMessage = notif.message
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0) // 空行を削除
      .join('\n');
    lines.push(cleanMessage);
    lines.push('');
    lines.push('-'.repeat(50));
    lines.push('');
  }

  // 最終的なメッセージから連続する空行を削除
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

