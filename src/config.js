import dotenv from 'dotenv';

dotenv.config();

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

// ページ範囲を生成（1からmaxPageまで）
function generatePageRange(maxPage, hotPages = 3) {
  const pages = [];
  for (let i = 1; i <= maxPage; i++) {
    pages.push(i);
  }
  return pages;
}

// コレクション設定をパース
function parseCollections() {
  const collectionsJson = str('COLLECTIONS', '');
  if (collectionsJson) {
    try {
      const parsed = JSON.parse(collectionsJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(c => {
          let pages = [];
          if (c.pages === 'all' || c.pages === '*') {
            // 全ページを指定（動的検出が必要）
            pages = 'auto'; // 後で動的検出
          } else if (Array.isArray(c.pages)) {
            pages = c.pages;
          } else if (typeof c.pages === 'string' && c.pages.includes('-')) {
            // 範囲指定（例: "1-53"）
            const [start, end] = c.pages.split('-').map(Number);
            if (Number.isFinite(start) && Number.isFinite(end)) {
              pages = generatePageRange(end).filter(p => p >= start);
            }
          } else if (c.pages) {
            pages = [Number(c.pages)].filter(Number.isFinite);
          } else {
            pages = [1, 2, 3]; // デフォルト
          }
          
          return {
            name: c.name || 'unknown',
            base: c.base || c.url,
            pages: pages,
            priority: c.priority || 'normal', // 'hot', 'normal', 'cold'
            autoDetectPages: pages === 'auto',
          };
        });
      }
    } catch (e) {
      console.warn('[config] COLLECTIONS JSON parse failed, using legacy config');
    }
  }
  
  // 後方互換性: 既存のTARGET_COLLECTION_BASEとPAGESを使用
  const legacyBase = str('TARGET_COLLECTION_BASE', 'https://www.hareruya2.com/collections/pmcg?filter.v.availability=1&sort_by=price-descending');
  const legacyPagesStr = str('PAGES', '1,2,3');
  let legacyPages;
  if (legacyPagesStr === 'all' || legacyPagesStr === '*') {
    legacyPages = 'auto';
  } else {
    legacyPages = legacyPagesStr.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
  }
  
  return [{
    name: 'PMCG',
    base: legacyBase,
    pages: legacyPages,
    priority: 'hot',
    autoDetectPages: legacyPages === 'auto',
  }];
}

export const config = {
  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
  slackWebhookUrl: str('SLACK_WEBHOOK_URL', ''),
  collections: parseCollections(),
  // 後方互換性のため残す
  targetCollectionBase: str('TARGET_COLLECTION_BASE', 'https://www.hareruya2.com/collections/pmcg?filter.v.availability=1&sort_by=price-descending'),
  pages: (str('PAGES', '1,2,3').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n))),
  priceThresholdYen: num('PRICE_THRESHOLD_YEN', 10000),
  rpsBudget: num('RPS_BUDGET', 0.8),
  hotIntervalSec: num('HOT_INTERVAL_SEC', 20),
  warmIntervalSec: num('WARM_INTERVAL_SEC', 60),
  coldIntervalSec: num('COLD_INTERVAL_SEC', 300),
  jitterMsMin: num('JITTER_MS_MIN', 200),
  jitterMsMax: num('JITTER_MS_MAX', 1200),
  dedupeCooldownSec: num('DEDUPE_COOLDOWN_SEC', 180),
  notifyTtlSec: num('NOTIFY_TTL_SEC', 900),
  // メール通知設定
  emailEnabled: str('EMAIL_ENABLED', 'false') === 'true',
  emailSmtpHost: str('EMAIL_SMTP_HOST', 'smtp.gmail.com'),
  emailSmtpPort: num('EMAIL_SMTP_PORT', 587),
  emailSmtpSecure: str('EMAIL_SMTP_SECURE', 'false') === 'true',
  emailSmtpUser: str('EMAIL_SMTP_USER', ''),
  emailSmtpPassword: str('EMAIL_SMTP_PASSWORD', ''),
  emailFrom: str('EMAIL_FROM', ''),
  emailTo: str('EMAIL_TO', ''),
  // 在庫減少・売り切れ通知設定
  notifyStockDecrease: str('NOTIFY_STOCK_DECREASE', 'false') === 'true',
  notifySoldOut: str('NOTIFY_SOLD_OUT', 'false') === 'true',
};

export function buildCollectionUrl(base, page) {
  try {
    const url = new URL(base);
    url.searchParams.set('page', String(page));
    return url.toString();
  } catch {
    // base にクエリがない素のURLが来た場合
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}page=${page}`;
  }
}

