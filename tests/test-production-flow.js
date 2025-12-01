/**
 * 本番環境フローテスト
 * 
 * このテストは、本番環境で製品情報が変更された際に
 * 実際にメールが送信されるかを確認します。
 * 
 * テストシナリオ:
 * 1. 在庫増加（StockIncreased）: 在庫0→1でメール送信
 * 2. #付きカード追加（NewHighPricePage）: 初回検知でメール送信
 */

import dotenv from 'dotenv';
dotenv.config();

import { config } from '../src/config.js';
import { getRedis, getProductState, setProductState, dedupeCheckAndSet } from '../src/redis.js';
import { sendSlack } from '../src/slack.js';
import { sendBatchEmail } from '../src/email.js';

// テスト用のユニークなIDを生成
const testId = Date.now();

// テスト用の商品データ
const testProducts = {
  // テスト1: 在庫増加
  stockIncrease: {
    handle: `test-stock-increase-${testId}`,
    productId: `test-${testId}-1`,
    title: `【テスト】在庫増加テスト商品 (ID: ${testId})`,
    url: `https://www.hareruya2.com/products/test-stock-increase-${testId}`,
    priceYen: 50000,
    totalStock: 2,  // 新しい在庫数
    hashNumber: null,
  },
  // テスト2: #付きカード追加
  newHighPricePage: {
    handle: `test-new-card-${testId}`,
    productId: `test-${testId}-2`,
    title: `【テスト】超高額カード #9999 テスト (ID: ${testId})`,
    url: `https://www.hareruya2.com/products/test-new-card-${testId}`,
    priceYen: 100000,
    totalStock: 1,
    hashNumber: '9999',
  },
};

// handleProduct関数のロジックを再現（watch.jsから抽出）
async function simulateHandleProduct(product, collectionName, prevStock = null, prevPrice = null, prevHashNumber = null) {
  const hashNumber = product.hashNumber;
  
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
  
  if (!identity) {
    console.warn(`[test] identityが空のためスキップ: ${product.title}`);
    return { notify: false, reason: 'identity empty' };
  }
  
  console.log(`[test] identity: ${identity}`);
  console.log(`[test] 前回状態 - 在庫: ${prevStock}, 価格: ${prevPrice}, hashNumber: ${prevHashNumber}`);
  console.log(`[test] 今回状態 - 在庫: ${product.totalStock}, 価格: ${product.priceYen}, hashNumber: ${hashNumber}`);
  
  // イベント判定
  let notify = false;
  let eventType = 'HighPriceInStock';
  
  if (prevStock === null) {
    // 初回検知
    notify = false;
    eventType = 'HighPriceInStock';
    if (hashNumber) {
      eventType = 'NewHighPricePage';
      notify = true;
    }
  } else if (hashNumber && prevHashNumber !== hashNumber) {
    notify = true;
    eventType = 'NewHighPricePage';
  } else if (prevStock === 0 && product.totalStock > 0) {
    notify = true;
    eventType = 'BackInStock';
  } else if (prevStock !== null && product.totalStock > prevStock) {
    const delta = product.totalStock - prevStock;
    if (delta >= 1) {
      notify = true;
      eventType = 'StockIncreased';
    }
  }
  
  console.log(`[test] イベント判定: ${eventType}, 通知: ${notify}`);
  
  if (!notify) {
    return { notify: false, eventType, reason: 'no notification needed' };
  }
  
  // 重複チェック
  const stockKey = prevStock !== null ? `${prevStock}->${product.totalStock}` : `null->${product.totalStock}`;
  const priceKey = prevPrice !== null ? `${prevPrice}->${product.priceYen}` : `null->${product.priceYen}`;
  const eid = `${eventType}::${identity}::${stockKey}::${priceKey}`;
  
  console.log(`[test] 重複チェック eventId: ${eid}`);
  
  const first = await dedupeCheckAndSet(eid, config.dedupeCooldownSec);
  if (!first) {
    console.log(`[test] 重複のためスキップ`);
    return { notify: false, eventType, reason: 'duplicate' };
  }
  
  // メッセージ生成
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
  console.log(`[test] 生成されたメッセージ:\n${message}`);
  
  // Slack送信（オプション）
  if (config.slackWebhookUrl) {
    try {
      await sendSlack(message);
      console.log(`[test] Slack送信成功`);
    } catch (error) {
      console.error(`[test] Slack送信失敗:`, error.message);
    }
  }
  
  // メール送信
  if (config.emailEnabled) {
    const notification = {
      eventType,
      message,
      product,
      timestamp: new Date().toISOString(),
    };
    
    try {
      await sendBatchEmail(collectionName, [notification]);
      console.log(`[test] メール送信成功`);
      return { notify: true, eventType, emailSent: true };
    } catch (error) {
      console.error(`[test] メール送信失敗:`, error.message);
      return { notify: true, eventType, emailSent: false, error: error.message };
    }
  } else {
    console.log(`[test] メール通知は無効化されています`);
    return { notify: true, eventType, emailSent: false, reason: 'email disabled' };
  }
}

async function main() {
  console.log('========================================');
  console.log('[test] 本番環境フローテスト開始');
  console.log(`[test] テストID: ${testId}`);
  console.log('========================================\n');
  
  // 設定確認
  console.log('[test] 現在の設定:');
  console.log(`  EMAIL_ENABLED: ${config.emailEnabled}`);
  console.log(`  EMAIL_TO: ${Array.isArray(config.emailTo) && config.emailTo.length > 0 ? config.emailTo.join(', ') : '(未設定)'}`);
  console.log(`  SLACK_WEBHOOK_URL: ${config.slackWebhookUrl ? '(設定済み)' : '(未設定)'}`);
  console.log('');
  
  // 設定チェック
  if (!config.emailEnabled || !config.emailTo || config.emailTo.length === 0) {
    console.error('[test] ❌ メール設定が不完全です');
    console.error('[test] EMAIL_ENABLED=true と EMAIL_TO を設定してください');
    process.exit(1);
  }
  
  // Redis接続確認
  try {
    const redis = getRedis();
    await redis.ping();
    console.log('[test] ✅ Redis接続成功\n');
  } catch (error) {
    console.error('[test] ❌ Redis接続失敗:', error.message);
    process.exit(1);
  }
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // ========================================
  // テスト1: 在庫増加（StockIncreased）
  // ========================================
  console.log('----------------------------------------');
  console.log('[test] テスト1: 在庫増加（StockIncreased）');
  console.log('----------------------------------------');
  console.log('[test] シナリオ: 在庫0→2の商品を検知してメール送信');
  console.log('');
  
  try {
    const product = testProducts.stockIncrease;
    const identity = product.handle;
    
    // Redisに前回の状態を設定（在庫0）
    console.log('[test] Redisに前回状態を設定: 在庫0');
    await setProductState(identity, {
      lastTotalStock: 0,
      lastEventType: 'HighPriceInStock',
      lastEventAt: new Date(Date.now() - 3600000).toISOString(), // 1時間前
      firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
      lastPriceYen: product.priceYen,
      lastHashNumber: '',
    });
    
    // 設定を確認
    const savedState = await getProductState(identity);
    console.log(`[test] 保存された状態: 在庫=${savedState?.lastTotalStock}`);
    
    // handleProductをシミュレート
    console.log('[test] handleProductをシミュレート...');
    const result = await simulateHandleProduct(
      product,
      'PMCG',
      savedState?.lastTotalStock,
      savedState?.lastPriceYen,
      savedState?.lastHashNumber
    );
    
    if (result.notify && result.emailSent) {
      console.log('[test] ✅ テスト1成功: 在庫増加でメール送信されました\n');
      testsPassed++;
    } else {
      console.error(`[test] ❌ テスト1失敗: ${result.reason || result.error || 'メール送信されませんでした'}\n`);
      testsFailed++;
    }
  } catch (error) {
    console.error('[test] ❌ テスト1エラー:', error.message);
    testsFailed++;
  }
  
  // 2秒待機
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // ========================================
  // テスト2: #付きカード追加（NewHighPricePage）
  // ========================================
  console.log('----------------------------------------');
  console.log('[test] テスト2: #付きカード追加（NewHighPricePage）');
  console.log('----------------------------------------');
  console.log('[test] シナリオ: タイトルに#9999を含む新規カードを初回検知してメール送信');
  console.log('');
  
  try {
    const product = testProducts.newHighPricePage;
    
    // このテストでは前回状態がない（初回検知）
    console.log('[test] 前回状態なし（初回検知）');
    
    // handleProductをシミュレート
    console.log('[test] handleProductをシミュレート...');
    const result = await simulateHandleProduct(
      product,
      'PMCG',
      null,  // 前回在庫なし
      null,  // 前回価格なし
      null   // 前回hashNumberなし
    );
    
    if (result.notify && result.emailSent) {
      console.log('[test] ✅ テスト2成功: #付きカード追加でメール送信されました\n');
      testsPassed++;
    } else {
      console.error(`[test] ❌ テスト2失敗: ${result.reason || result.error || 'メール送信されませんでした'}\n`);
      testsFailed++;
    }
  } catch (error) {
    console.error('[test] ❌ テスト2エラー:', error.message);
    testsFailed++;
  }
  
  // ========================================
  // 結果サマリー
  // ========================================
  console.log('========================================');
  console.log('[test] テスト結果サマリー');
  console.log('========================================');
  console.log(`  成功: ${testsPassed}件`);
  console.log(`  失敗: ${testsFailed}件`);
  console.log('');
  
  if (testsFailed === 0) {
    console.log('[test] ✅ すべてのテストが成功しました！');
    console.log('');
    console.log('送信されたメール:');
    console.log('  1. 在庫増加通知（件名: 【PMCG】在庫・価格変動通知 (1件)）');
    console.log('  2. #付きカード追加通知（件名: #9999在庫追加）');
    console.log('');
    console.log(`送信先: ${config.emailTo.join(', ')}`);
    console.log('');
    console.log('受信ボックス（および迷惑メールフォルダ）を確認してください。');
  } else {
    console.error('[test] ❌ 一部のテストが失敗しました');
    console.error('[test] ログを確認して原因を特定してください');
  }
  
  // Redis接続を閉じる
  const redis = getRedis();
  await redis.quit();
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[test] エラー:', err);
  process.exit(1);
});

