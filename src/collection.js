import { load } from 'cheerio';
import crypto from 'node:crypto';
import { buildCollectionUrl, config } from './config.js';
import { getCollectionHash, setCollectionHash } from './redis.js';

function shortHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

export async function fetchCollectionPage(collectionBase, page) {
  // 後方互換性: collectionBaseが未指定の場合は既存の設定を使用
  const base = collectionBase || config.targetCollectionBase;
  const url = buildCollectionUrl(base, page);
  const res = await fetch(url, { headers: { 'User-Agent': 'hareruya2bot/1.0' }});
  if (!res.ok) throw new Error(`collection ${page} fetch failed ${res.status}`);
  const html = await res.text();
  const hash = shortHash(html);
  const last = await getCollectionHash(url);
  const changed = last !== hash;
  if (changed) await setCollectionHash(url, hash);
  const $ = load(html);
  const productLinks = new Set();
  $('a[href^="/products/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    // 正規化（クエリ/フラグメントは不要）
    try {
      const u = new URL(href, base);
      u.search = '';
      u.hash = '';
      productLinks.add(u.toString());
    } catch {
      // ignore
    }
  });
  return { url, changed, links: Array.from(productLinks) };
}

// ページネーションから最大ページ数を検出
export async function detectMaxPage(collectionBase) {
  try {
    const { url, changed } = await fetchCollectionPage(collectionBase, 1);
    const res = await fetch(url, { headers: { 'User-Agent': 'hareruya2bot/1.0' }});
    if (!res.ok) return null;
    const html = await res.text();
    const $ = load(html);
    
    // ページネーションリンクから最大ページ数を探す
    // 「次」リンクやページ番号リンクから検出
    let maxPage = 1;
    
    // ページ番号リンクを探す（例: <a href="?page=53">53</a>）
    $('a[href*="page="]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const urlObj = new URL(href, collectionBase);
        const pageParam = urlObj.searchParams.get('page');
        if (pageParam) {
          const pageNum = Number(pageParam);
          if (Number.isFinite(pageNum) && pageNum > maxPage) {
            maxPage = pageNum;
          }
        }
      } catch {
        // ignore
      }
    });
    
    // テキストからも検出（例: «前 1234…18 次»）
    const paginationText = $('.pagination, .pager, [class*="page"]').text();
    const pageMatches = paginationText.match(/\b(\d{1,3})\b/g);
    if (pageMatches) {
      for (const match of pageMatches) {
        const num = Number(match);
        if (Number.isFinite(num) && num > maxPage && num < 1000) {
          maxPage = num;
        }
      }
    }
    
    return maxPage > 1 ? maxPage : null;
  } catch (e) {
    console.warn('[collection] 最大ページ数検出失敗:', e.message);
    return null;
  }
}

