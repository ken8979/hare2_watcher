import { load } from 'cheerio';
import crypto from 'node:crypto';
import { buildCollectionUrl, config } from './config.js';
import { getCollectionHash, setCollectionHash } from './redis.js';
import { extractHashNumber } from './product.js';

function shortHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

// 価格文字列をパース（例: "¥10,000" → 10000）
function parsePriceYen(priceText) {
  if (!priceText) return null;
  // 数字とカンマのみを抽出
  const cleaned = priceText.replace(/[^\d,]/g, '').replace(/,/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// テキストから余分なスペースや改行を削除
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')  // 連続する空白を1つに
    .replace(/\n+/g, ' ')  // 改行をスペースに
    .replace(/\r+/g, ' ')  // キャリッジリターンをスペースに
    .replace(/単価\s*\/\s*あたり/g, '')  // 「単価 / あたり」を削除
    .replace(/単価\/あたり/g, '')  // 「単価/あたり」を削除
    .replace(/\s+/g, ' ')  // 削除後の連続する空白を1つに
    .trim();                // 前後の空白を削除
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
  
  // 商品情報を一覧ページから直接抽出
  const products = [];
  const productLinks = new Set();
  
  // 商品カード/アイテムを探す（一般的なShopifyのセレクタ）
  // 複数のパターンを試す
  const productSelectors = [
    '.product-item',
    '.product-card',
    '[class*="product"]',
    'article[class*="product"]',
    'div[class*="product"]',
  ];
  
  let productElements = [];
  for (const selector of productSelectors) {
    productElements = $(selector);
    if (productElements.length > 0) break;
  }
  
  // 商品が見つからない場合は、商品リンクから推測
  if (productElements.length === 0) {
    $('a[href^="/products/"]').each((_, el) => {
      const $link = $(el);
      const href = $link.attr('href');
      if (!href) return;
      
      try {
        const u = new URL(href, base);
        u.search = '';
        u.hash = '';
        const productUrl = u.toString();
        productLinks.add(productUrl);
        
        // リンク周辺から商品情報を抽出
        const $card = $link.closest('div, article, li');
        const rawTitle = $link.text().trim() || $link.attr('title') || $card.find('h2, h3, .title, [class*="title"]').first().text().trim();
        const title = cleanText(rawTitle);
        const priceText = $card.find('.price, [class*="price"], .money').first().text().trim();
        const priceYen = parsePriceYen(priceText);
        
        // 在庫情報（「在庫あり」「売り切れ」など）
        const stockText = $card.text().toLowerCase();
        const inStock = !stockText.includes('売り切れ') && !stockText.includes('sold out') && !stockText.includes('out of stock');
        const totalStock = inStock ? 1 : 0; // 精度を無視するため、在庫あり=1、売り切れ=0
        
        if (title) {
          // handleを抽出（クエリパラメータを除去）
          let handle = href.split('/products/')[1]?.split('/')[0] || '';
          // クエリパラメータ（?以降）を除去
          if (handle.includes('?')) {
            handle = handle.split('?')[0];
          }
          // URLから直接handleを抽出（より確実な方法）
          try {
            const urlObj = new URL(href, base);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length >= 2 && pathParts[0] === 'products') {
              handle = pathParts[1]; // /products/handle から handle を取得
            }
          } catch {
            // URL解析に失敗した場合は、既存のhandleを使用
          }
          products.push({
            productId: handle,
            handle: handle,
            title: title,
            url: productUrl,
            totalStock: totalStock,
            priceYen: priceYen || 0,
            hashNumber: extractHashNumber(title),
          });
        }
      } catch {
        // ignore
      }
    });
  } else {
    // 商品カードから情報を抽出
    productElements.each((_, el) => {
      const $card = $(el);
      const $link = $card.find('a[href^="/products/"]').first();
      const href = $link.attr('href');
      if (!href) return;
      
      try {
        const u = new URL(href, base);
        u.search = '';
        u.hash = '';
        const productUrl = u.toString();
        productLinks.add(productUrl);
        
        const rawTitle = $link.text().trim() || $link.attr('title') || $card.find('h2, h3, .title, [class*="title"]').first().text().trim();
        const title = cleanText(rawTitle);
        const priceText = $card.find('.price, [class*="price"], .money').first().text().trim();
        const priceYen = parsePriceYen(priceText);
        
        // 在庫情報
        const stockText = $card.text().toLowerCase();
        const inStock = !stockText.includes('売り切れ') && !stockText.includes('sold out') && !stockText.includes('out of stock');
        const totalStock = inStock ? 1 : 0;
        
        if (title) {
          // handleを抽出（クエリパラメータを除去）
          let handle = href.split('/products/')[1]?.split('/')[0] || '';
          // クエリパラメータ（?以降）を除去
          if (handle.includes('?')) {
            handle = handle.split('?')[0];
          }
          // URLから直接handleを抽出（より確実な方法）
          try {
            const urlObj = new URL(href, base);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length >= 2 && pathParts[0] === 'products') {
              handle = pathParts[1]; // /products/handle から handle を取得
            }
          } catch {
            // URL解析に失敗した場合は、既存のhandleを使用
          }
          products.push({
            productId: handle,
            handle: handle,
            title: title,
            url: productUrl,
            totalStock: totalStock,
            priceYen: priceYen || 0,
            hashNumber: extractHashNumber(title),
          });
        }
      } catch {
        // ignore
      }
    });
  }
  
  return { 
    url, 
    changed, 
    links: Array.from(productLinks),
    products: products, // 一覧ページから抽出した商品情報
  };
}

// ページネーションから最大ページ数を検出
export async function detectMaxPage(collectionBase) {
  try {
    const url = buildCollectionUrl(collectionBase, 1);
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

