import { config } from './config.js';

export async function sendSlack(message) {
  if (!config.slackWebhookUrl) {
    console.log('[notify]', message);
    return;
  }
  const body = {
    text: message,
  };
  const res = await fetch(config.slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: ${res.status} ${txt}`);
  }
}

