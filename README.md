# hareruya2bot watcher

常駐ウォッチャーが複数コレクションを監視し、¥10,000以上かつ在庫>0の商品をSlackへ通知します。

## 環境変数

### 基本設定

`.env` を作成:

```
REDIS_URL=redis://localhost:6379
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
PRICE_THRESHOLD_YEN=10000
RPS_BUDGET=0.8
HOT_INTERVAL_SEC=20
WARM_INTERVAL_SEC=60
COLD_INTERVAL_SEC=300
JITTER_MS_MIN=200
JITTER_MS_MAX=1200
DEDUPE_COOLDOWN_SEC=180

# メール通知設定（オプション）
EMAIL_ENABLED=false
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your-email@gmail.com
EMAIL_SMTP_PASSWORD=your-app-password
EMAIL_FROM=your-email@gmail.com
EMAIL_TO=recipient@example.com

# 在庫減少・売り切れ通知設定（オプション）
NOTIFY_STOCK_DECREASE=false
NOTIFY_SOLD_OUT=false
```

### コレクション設定（2つの方法）

#### 方法1: 複数コレクション対応（推奨）

`COLLECTIONS`環境変数にJSON形式で複数コレクションを指定:

```json
COLLECTIONS=[{"name":"PMCG","base":"https://www.hareruya2.com/collections/pmcg?filter.v.availability=1&sort_by=price-descending","pages":"all","priority":"hot"},{"name":"SV-P","base":"https://www.hareruya2.com/collections/sv-p?filter.v.availability=1&sort_by=price-descending","pages":"1-10","priority":"normal"}]
```

**設定項目:**
- `name`: コレクション名（ログ表示用）
- `base`: コレクションのベースURL
- `pages`: ページ指定
  - `"all"` または `"*"`: 全ページを自動検出
  - `"1-53"`: 範囲指定（1から53まで）
  - `[1,2,3]`: 配列で明示的に指定
- `priority`: 優先度
  - `"hot"`: 高頻度（HOT_INTERVAL_SEC間隔）
  - `"normal"`: 中頻度（WARM_INTERVAL_SEC間隔）
  - `"cold"`: 低頻度（COLD_INTERVAL_SEC間隔）

**大量のコレクションを追加する場合:**

`collections-config.json`ファイルを編集して、スクリプトで環境変数を生成:

```bash
# 1. collections-config.jsonを編集
# 2. 環境変数を生成して.envに追加
node scripts/generate-collections-env.js >> .env
```

詳細は`scripts/README.md`を参照してください。

#### 方法2: 単一コレクション（後方互換性）

既存の設定方法も使用可能:

```
TARGET_COLLECTION_BASE=https://www.hareruya2.com/collections/pmcg?filter.v.availability=1&sort_by=price-descending
PAGES=1,2,3
```

または全ページを自動検出:

```
PAGES=all
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm i
```

### 2. 環境変数の設定

`.env`ファイルを作成し、必要な環境変数を設定してください（上記「環境変数」セクションを参照）。

### 3. Redisの起動

ローカル開発環境の場合:

```bash
# macOS (Homebrew)
brew services start redis

# Docker
docker run -d -p 6379:6379 redis:latest
```

本番環境では、Upstash Redisなどのマネージドサービスを推奨します。

### 4. 動作確認（テスト）

```bash
# 設定確認
npm run test:config

# 動的ページ数検出テスト
npm run test:pages

# ワンショット実行（1回だけ実行）
npm run oneshot

# シミュレーションテスト（単一商品）
PRICE_THRESHOLD_YEN=1000 npm run test:simulate
PRICE_THRESHOLD_YEN=1000 npm run oneshot

# シミュレーションテスト（複数商品）
PRICE_THRESHOLD_YEN=1000 npm run test:simulate-multi
PRICE_THRESHOLD_YEN=1000 npm run oneshot
```

詳細は`tests/README.md`を参照してください。

### 5. 常駐実行開始

```bash
npm run start
```

## 動作
- 複数コレクションを優先度に応じた間隔で監視
- page1-3は常に商品JSONを取得（ハッシュ変化に関係なく）
- 一覧HTMLのハッシュが変化した場合に商品JSONを並列取得
- 価格>=10,000円かつ在庫>0の商品に対して、初回/増加/再入荷/価格変動をSlack通知
- 重複通知をクールダウン（既定180秒）で抑制
- 在庫増加の誤検知対策（delta >= 1を明示的にチェック）

### 通知イベントタイプ
- **HighPriceInStock**: 初回検知（条件に合致する商品を初めて検出）
- **StockIncreased**: 在庫増加（在庫が1以上増加）
- **BackInStock**: 再入荷（在庫0から在庫あり）
- **PriceChanged**: 価格変動
- **NewHighPricePage**: 新規高額カードページ検知（タイトルに#数字4桁を含む商品）
- **StockDecreased**: 在庫減少（`NOTIFY_STOCK_DECREASE=true`で有効化）
- **SoldOut**: 売り切れ（`NOTIFY_SOLD_OUT=true`で有効化）

### メール通知
- `EMAIL_ENABLED=true`でメール通知を有効化
- Gmail、SendGridなどのSMTPサーバーに対応
- Slack通知と同じ内容をメールでも送信

## バグ修正
- ✅ 在庫が増加していない商品も増加したと検知してしまう → delta >= 1を明示的にチェック
- ✅ 特定の商品を繰り返し通知してしまう → 重複防止キーに在庫/価格の変化を含める
- ✅ 目視で確認した際に増加している商品の通知が来ない → page1は常に商品JSON取得

## インフラ要件と推奨環境

### 推奨インフラ構成

#### 本番環境

1. **実行環境**
   - **Fly.io** (推奨)
     - 常駐実行が可能
     - スケーリングが容易
     - コスト効率が良い
   - **Render**
     - 簡単なデプロイ
     - 無料プランあり
   - **AWS ECS Fargate / Google Cloud Run**
     - エンタープライズ向け

2. **Redis**
   - **Upstash Redis** (推奨)
     - サーバーレスRedis
     - 無料プランあり
     - 自動スケーリング
   - **Redis Cloud**
     - マネージドRedisサービス
   - **AWS ElastiCache / Google Cloud Memorystore**
     - エンタープライズ向け

3. **通知**
   - **Slack Webhook** (実装済み)
   - **メール通知** (将来実装予定)

### リソース要件

- **メモリ**: 最低128MB、推奨256MB
- **CPU**: 低負荷（常時監視のみ）
- **ネットワーク**: 外向きHTTPS接続が必要
- **ストレージ**: 不要（Redisに状態を保存）

### デプロイ例（Fly.io）

```bash
# fly.tomlを作成
fly launch

# Redis URLを設定
fly secrets set REDIS_URL=redis://your-redis-url

# その他の環境変数を設定
fly secrets set SLACK_WEBHOOK_URL=...
fly secrets set PRICE_THRESHOLD_YEN=10000
fly secrets set COLLECTIONS='[...]'

# デプロイ
fly deploy
```

### デプロイ例（Render）

1. Renderダッシュボードで「New Web Service」を選択
2. GitHubリポジトリを接続
3. 環境変数を設定
4. ビルドコマンド: `npm i`
5. 起動コマンド: `npm run start`

### 監視とログ

- **ログ**: 標準出力に出力されるため、各プラットフォームのログ機能を使用
- **アラート**: Slack通知で異常を検知
- **メトリクス**: Redisのキー数やリクエスト数を監視

## 注意事項

- 相手サイトの利用規約とレート制限を尊重してください
- リクエストレートは`RPS_BUDGET`で制御（デフォルト0.8 req/sec）
- 全53ページを監視する場合は、リクエスト回数に注意してください
- 重複通知は`DEDUPE_COOLDOWN_SEC`（デフォルト180秒）で抑制されます
- 本番環境では、`.env`ファイルをGitにコミットしないでください

## トラブルシューティング

### Redis接続エラー

```
Error: connect ECONNREFUSED
```

→ Redisが起動しているか確認してください。本番環境では`REDIS_URL`が正しく設定されているか確認してください。

### Slack通知が届かない

→ `SLACK_WEBHOOK_URL`が正しく設定されているか確認してください。テストは`tests/simulate-multi.js`で実行できます。

### 通知が重複する

→ `DEDUPE_COOLDOWN_SEC`を調整してください。デフォルトは180秒です。

### ページ数検出が失敗する

→ `pages: "all"`の代わりに、明示的にページ数を指定してください（例: `pages: "1-53"`）。

