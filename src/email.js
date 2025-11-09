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

