import dotenv from 'dotenv';
dotenv.config();
import { config } from '../src/config.js';
import { fetchCollectionPage } from '../src/collection.js';
import { isTargetProduct } from '../src/product.js';
import { getProductState, setProductState, dedupeCheckAndSet, getRedis } from '../src/redis.js';
import { sendBatchEmail } from '../src/email.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[test-newhighpricepage-immediate] #数字4桁の新規追加即時メール送信テスト');
  console.log('[test-newhighpricepage-immediate] 期待される動作: #1929, #1930が発見されたら即座にメール送信');
  
  console.log('[test-newhighpricepage-immediate] 設定確認:');
  console.log('  EMAIL_ENABLED:', config.emailEnabled);
  console.log('  EMAIL_TO:', process.env.EMAIL_TO);
  console.log('  PRICE_THRESHOLD_YEN:', config.priceThresholdYen);

  if (!config.emailEnabled) {
    console.error('[test-newhighpricepage-immediate] ❌ メール通知が無効化されています');
    console.error('[test-newhighpricepage-immediate] .envファイルで EMAIL_ENABLED=true に設定してください');
    process.exit(1);
  }

  if (!process.env.EMAIL_TO) {
    console.error('[test-newhighpricepage-immediate] ❌ EMAIL_TOが設定されていません');
    process.exit(1);
  }

  const collection = config.collections[0];
  if (!collection) {
    console.error('[test-newhighpricepage-immediate] ❌ コレクションが設定されていません');
    process.exit(1);
  }

  console.log(`\n[test-newhighpricepage-immediate] 対象コレクション: ${collection.name}`);
  console.log(`[test-newhighpricepage-immediate] 商品を検索中...`);

  // 実際の商品を取得（テスト用）
  const page = Array.isArray(collection.pages) ? collection.pages[0] : 1;
  let products = null;
  let retries = 3;
  while (retries > 0 && !products) {
    try {
      const result = await fetchCollectionPage(collection.base, page);
      products = result.products;
      break;
    } catch (error) {
      retries--;
      if (retries > 0) {
        console.log(`[test-newhighpricepage-immediate] リトライ中... (残り${retries}回)`);
        await sleep(2000);
      } else {
        throw error;
      }
    }
  }

  if (!products || products.length === 0) {
    console.error('[test-newhighpricepage-immediate] ❌ 商品が見つかりませんでした');
    process.exit(1);
  }

  // 対象商品を探す（価格閾値以上、在庫あり）
  const targetProducts = [];
  for (const product of products) {
    if (isTargetProduct(product)) {
      targetProducts.push(product);
      if (targetProducts.length >= 2) break; // 2件まで
    }
  }

  if (targetProducts.length === 0) {
    console.error('[test-newhighpricepage-immediate] ❌ 対象商品が見つかりませんでした');
    process.exit(1);
  }

  console.log(`\n[test-newhighpricepage-immediate] ${targetProducts.length}件の商品をベースに使用`);
  
  const redis = getRedis();
  const notifications = [];

  // #1929と#1930を含む商品をシミュレート
  const hashNumbers = ['1929', '1930'];
  
  for (let i = 0; i < hashNumbers.length && i < targetProducts.length; i++) {
    const hashNumber = hashNumbers[i];
    const baseProduct = targetProducts[i];
    
    // 商品タイトルに#数字4桁を追加
    const modifiedTitle = `${baseProduct.title} #${hashNumber}`;
    
    const product = {
      ...baseProduct,
      title: modifiedTitle,
      hashNumber: hashNumber,
    };

    console.log(`\n[test-newhighpricepage-immediate] ========================================`);
    console.log(`[test-newhighpricepage-immediate] 商品 ${i + 1}: #${hashNumber}`);
    console.log(`[test-newhighpricepage-immediate] タイトル: ${product.title.substring(0, 60)}...`);
    console.log(`[test-newhighpricepage-immediate] 価格: ¥${product.priceYen.toLocaleString()}`);
    console.log(`[test-newhighpricepage-immediate] 在庫: ${product.totalStock}`);

    // identityを生成
    let identity = product.handle || product.productId;
    if (!identity && product.url) {
      try {
        const urlObj = new URL(product.url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'products') {
          identity = pathParts[1];
        } else {
          identity = product.url;
        }
      } catch {
        identity = product.url;
      }
    }
    
    if (hashNumber) {
      identity = `${identity}::#${hashNumber}`;
    }

    console.log(`[test-newhighpricepage-immediate] Identity: ${identity}`);

    // Redisから状態を取得（初回検知として扱うため、状態をクリア）
    const redisKey = `product_state:${identity}`;
    await redis.del(redisKey);
    console.log(`[test-newhighpricepage-immediate] Redis状態をクリア: ${identity}`);
    
    // 重複防止キーもクリア（テスト用）
    const dedupeKeys = await redis.keys(`dedupe:event:NewHighPricePage::${identity}::*`);
    if (dedupeKeys.length > 0) {
      await redis.del(...dedupeKeys);
      console.log(`[test-newhighpricepage-immediate] 重複防止キーをクリア: ${dedupeKeys.length}件`);
    }

    const prev = await getProductState(identity);
    const prevStock = prev?.lastTotalStock ?? null;
    const prevHashNumber = prev?.lastHashNumber || null;

    console.log(`[test-newhighpricepage-immediate] 前回状態: 在庫=${prevStock ?? 'N/A'}, hashNumber=${prevHashNumber ?? 'N/A'}`);

    // イベント判定ロジックをシミュレート（watch.jsと同じ）
    let notify = false;
    let eventType = 'HighPriceInStock';

    if (prevStock === null) {
      // 初回検知
      notify = false;
      eventType = 'HighPriceInStock';
      if (hashNumber) {
        eventType = 'NewHighPricePage';
        notify = true; // NewHighPricePageの場合は通知
      }
      console.log(`[test-newhighpricepage-immediate] → 初回検知: ${notify ? '通知あり（NewHighPricePage）' : '通知なし'}`);
    } else if (hashNumber && prevHashNumber !== hashNumber) {
      // 新規高額カードページ検知: #数字4桁が変わった場合
      notify = true;
      eventType = 'NewHighPricePage';
      console.log(`[test-newhighpricepage-immediate] → hashNumber変更: 通知あり（NewHighPricePage）`);
    }

    if (notify && eventType === 'NewHighPricePage') {
      // 重複防止チェック
      const stockKey = prevStock !== null ? `${prevStock}->${product.totalStock}` : `null->${product.totalStock}`;
      const priceKey = null !== null ? `${null}->${product.priceYen}` : `null->${product.priceYen}`;
      const eid = `${eventType}::${identity}::${stockKey}::${priceKey}`;
      const first = await dedupeCheckAndSet(eid, config.dedupeCooldownSec);

      if (first) {
        console.log(`[test-newhighpricepage-immediate] ✅ 通知送信: ${eventType}`);
        
        // メッセージを作成（watch.jsと同じフォーマット）
        const cleanTitle = (product.title || '').replace(/\s+/g, ' ').trim();
        const msgParts = [];

        if (eventType !== 'HighPriceInStock') {
          msgParts.push(`【${eventType}】¥${product.priceYen.toLocaleString()} 在庫${product.totalStock}`);
        }

        msgParts.push(cleanTitle);
        msgParts.push(product.url);
        if (prevStock !== null) {
          msgParts.push(`在庫: ${prevStock} → ${product.totalStock}`);
        } else {
          msgParts.push(`在庫: N/A → ${product.totalStock}`);
        }

        const message = msgParts.join('\n');

        // 即時メール送信をシミュレート
        console.log(`[test-newhighpricepage-immediate] 即時メール送信を開始...`);
        console.log(`[test-newhighpricepage-immediate] メッセージ内容:`);
        console.log(message);
        console.log(`[test-newhighpricepage-immediate] ---`);

        try {
          await sendBatchEmail(collection.name, [{
            eventType,
            message,
            product,
            timestamp: new Date().toISOString(),
          }]);
          console.log(`[test-newhighpricepage-immediate] ✅ 即時メール送信成功！`);
          notifications.push({
            hashNumber,
            product,
            eventType,
            message,
          });
        } catch (error) {
          console.error(`[test-newhighpricepage-immediate] ❌ 即時メール送信失敗:`, error.message);
        }
      } else {
        console.log(`[test-newhighpricepage-immediate] ⏭️  重複防止により通知スキップ`);
      }
    }

    // 状態を保存
    try {
      await setProductState(identity, {
        lastTotalStock: product.totalStock,
        lastEventType: notify ? eventType : '',
        lastEventAt: notify ? new Date().toISOString() : '',
        firstSeenAt: new Date().toISOString(),
        lastPriceYen: product.priceYen,
        lastHashNumber: hashNumber || '',
      });
      console.log(`[test-newhighpricepage-immediate] 💾 状態を保存`);
    } catch (error) {
      console.error(`[test-newhighpricepage-immediate] ❌ Redis状態保存失敗:`, error.message);
    }

    // 商品間で少し待機
    await sleep(1000);
  }

  console.log(`\n[test-newhighpricepage-immediate] ========================================`);
  console.log(`[test-newhighpricepage-immediate] テスト結果サマリー`);
  console.log(`[test-newhighpricepage-immediate] ========================================`);
  console.log(`[test-newhighpricepage-immediate] 即時メール送信件数: ${notifications.length}件`);
  
  if (notifications.length === hashNumbers.length) {
    console.log(`[test-newhighpricepage-immediate] ✅ 期待通り: ${hashNumbers.length}件すべて即時メール送信されました`);
    notifications.forEach((notif, index) => {
      console.log(`\n  ${index + 1}. #${notif.hashNumber}:`);
      console.log(`     タイトル: ${notif.product.title.substring(0, 50)}...`);
      console.log(`     価格: ¥${notif.product.priceYen.toLocaleString()}`);
    });
  } else {
    console.log(`[test-newhighpricepage-immediate] ⚠️  注意: ${notifications.length}件のみ送信されました（期待: ${hashNumbers.length}件）`);
  }

  console.log(`\n[test-newhighpricepage-immediate] ${process.env.EMAIL_TO} にメールが送信されました`);
  console.log(`[test-newhighpricepage-immediate] 受信ボックス（および迷惑メールフォルダ）を確認してください。`);

  await redis.quit();
  console.log('\n[test-newhighpricepage-immediate] テスト完了');
}

main().catch(err => {
  console.error('[test-newhighpricepage-immediate] エラー:', err);
  process.exit(1);
});

