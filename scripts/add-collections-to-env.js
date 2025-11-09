#!/usr/bin/env node
/**
 * collections-config.jsonからCOLLECTIONS環境変数を生成して.envファイルに追加/更新するスクリプト
 * 
 * 使用方法:
 *   node scripts/add-collections-to-env.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', 'collections-config.json');
const envPath = path.join(__dirname, '..', '.env');

try {
  // collections-config.jsonを読み込む
  const configJson = fs.readFileSync(configPath, 'utf-8');
  const collections = JSON.parse(configJson);
  const collectionsEnv = JSON.stringify(collections);
  const newLine = `COLLECTIONS=${collectionsEnv}\n`;
  
  console.log(`[add-collections-to-env] ${collections.length}件のコレクションを読み込みました`);
  
  // .envファイルを読み込む
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }
  
  // COLLECTIONS行を削除または追加
  const lines = envContent.split('\n');
  const filteredLines = lines.filter(line => !line.startsWith('COLLECTIONS='));
  
  // 新しいCOLLECTIONS行を追加
  filteredLines.push(newLine.trim());
  
  // .envファイルに書き込む
  const newEnvContent = filteredLines.join('\n') + '\n';
  fs.writeFileSync(envPath, newEnvContent, 'utf-8');
  
  console.log(`[add-collections-to-env] ✅ .envファイルを更新しました`);
  console.log(`[add-collections-to-env] COLLECTIONS環境変数を追加/更新しました`);
  console.log(`[add-collections-to-env] コレクション数: ${collections.length}件`);
  console.log(`[add-collections-to-env]`);
  console.log(`[add-collections-to-env] 次のステップ:`);
  console.log(`[add-collections-to-env] 1. PM2を再起動: pm2 restart hareruya2bot`);
  console.log(`[add-collections-to-env] 2. ログを確認: pm2 logs hareruya2bot`);
  
} catch (error) {
  console.error('[add-collections-to-env] ❌ エラー:', error.message);
  process.exit(1);
}

