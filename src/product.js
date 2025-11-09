import { config } from './config.js';

function parseYenFromShopifyPrice(priceStr) {
  // Shopifyのpriceは整数のセンチ単位（例: 1000000 = ¥10,000）であることが多い
  const n = Number(priceStr);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 100);
}

export async function fetchProductJsonByUrl(productUrl) {
  // productUrl: https://www.hareruya2.com/products/XXXXX
  let handleOrId = null;
  try {
    const u = new URL(productUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    handleOrId = parts[1]; // ['products','xxxxx'] → 'xxxxx'
  } catch {}
  if (!handleOrId) return null;
  const jsonUrl = `https://www.hareruya2.com/products/${handleOrId}.js`;
  const res = await fetch(jsonUrl, { headers: { 'User-Agent': 'hareruya2bot/1.0' }});
  if (!res.ok) return null;
  const data = await res.json();
  // fields: id, handle, title, variants[] { id, title, available, inventory_quantity, price }
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const totalStock = variants.reduce((acc, v) => {
    const inv = Number(v.inventory_quantity);
    if (v.available === true) {
      // 在庫数が不明/0でも販売可能な場合は1とみなす
      const assumed = Number.isFinite(inv) && inv > 0 ? inv : 1;
      return acc + assumed;
    }
    return acc + (Number.isFinite(inv) && inv > 0 ? inv : 0);
  }, 0);
  const maxVariantPriceYen = variants.reduce((acc, v) => {
    const py = parseYenFromShopifyPrice(v.price);
    return Math.max(acc, py ?? 0);
  }, 0);
  const hashNumber = extractHashNumber(data.title);
  
  return {
    productId: data.id,
    handle: data.handle,
    title: data.title,
    url: productUrl,
    totalStock,
    priceYen: maxVariantPriceYen,
    hashNumber: hashNumber, // #数字4桁（例: "1384"）
  };
}

// タイトルから#数字4桁を抽出（例: "#1384" → "1384"）
export function extractHashNumber(title) {
  if (!title) return null;
  const match = title.match(/#(\d{4})/);
  return match ? match[1] : null;
}

export function isTargetProduct(p) {
  if (!p) return false;
  if (p.totalStock <= 0) return false;
  if (p.priceYen < config.priceThresholdYen) return false;
  return true;
}

