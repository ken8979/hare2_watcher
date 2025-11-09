#!/usr/bin/env node
/**
 * コレクション設定をJSONファイルから読み込んで、.env形式のCOLLECTIONS環境変数を生成するスクリプト
 * 
 * 使用方法:
 *   node scripts/generate-collections-env.js > collections.env
 *   または
 *   node scripts/generate-collections-env.js | pbcopy  # macOSでクリップボードにコピー
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', 'collections-config.json');

try {
  const configJson = fs.readFileSync(configPath, 'utf-8');
  const collections = JSON.parse(configJson);
  
  // JSONを1行に圧縮して環境変数形式で出力
  const collectionsEnv = JSON.stringify(collections);
  console.log(`COLLECTIONS=${collectionsEnv}`);
} catch (error) {
  console.error('エラー:', error.message);
  console.error('collections-config.jsonファイルを読み込めませんでした');
  process.exit(1);
}

