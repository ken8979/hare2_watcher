# プロジェクト構造

## ディレクトリ構成

```
hare2/
├── src/                    # ソースコード
│   ├── config.js          # 設定管理（環境変数読み込み、複数コレクション設定）
│   ├── collection.js      # コレクションページ取得・パース、動的ページ数検出
│   ├── product.js         # 商品JSON取得・在庫/価格計算
│   ├── redis.js           # Redis接続・状態管理
│   ├── slack.js           # Slack通知送信
│   ├── watch.js           # 常駐ウォッチャー（メインループ）
│   └── oneshot.js         # ワンショット実行（テスト・デバッグ用）
├── tests/                  # テストファイル
│   ├── README.md          # テストの使い方
│   ├── test-config.js     # 設定確認テスト
│   ├── test-pages.js      # 動的ページ数検出テスト
│   ├── test-multi-collection.js  # 複数コレクション設定テスト
│   ├── simulate.js        # 単一商品シミュレーション
│   └── simulate-multi.js  # 複数商品シミュレーション
├── .env                    # 環境変数（Gitにコミットしない）
├── .gitignore             # Git除外設定
├── package.json           # 依存関係・スクリプト定義
├── README.md              # プロジェクト説明・セットアップ手順
├── REQUIREMENTS_CHECK.md  # 要件チェック結果・実装状況
└── PROJECT_STRUCTURE.md   # このファイル
```

## 主要ファイルの役割

### src/config.js
- 環境変数の読み込みとパース
- 複数コレクション設定の処理
- 後方互換性の維持

### src/watch.js
- 常駐ウォッチャーのメインループ
- 複数コレクションの優先度付きスケジューリング
- 商品の在庫・価格変動検知と通知

### src/collection.js
- コレクションページのHTML取得
- 商品リンクの抽出
- ページネーションからの最大ページ数検出

### src/product.js
- Shopify JSON APIからの商品情報取得
- 在庫数・価格の計算
- 対象商品のフィルタリング

### src/redis.js
- Redis接続管理
- 商品状態の保存・取得
- 重複通知防止キーの管理

### src/slack.js
- Slack Webhookへの通知送信
- エラーハンドリング

## データフロー

```
1. watch.js (mainLoop)
   ↓
2. collection.js (fetchCollectionPage)
   → HTML取得 → ハッシュ比較 → 商品リンク抽出
   ↓
3. product.js (fetchProductJsonByUrl)
   → Shopify JSON取得 → 在庫/価格計算
   ↓
4. watch.js (handleProduct)
   → Redisから前回状態取得 → 変動検知
   ↓
5. slack.js (sendSlack)
   → 通知送信
   ↓
6. redis.js (setProductState)
   → 現在状態を保存
```

## テストファイルの役割

### tests/test-config.js
設定が正しく読み込まれているか確認

### tests/test-pages.js
動的ページ数検出機能の動作確認

### tests/simulate.js
単一商品の在庫・価格変動をシミュレート

### tests/simulate-multi.js
複数商品の異なる変動パターンをシミュレート

## 環境変数

詳細は`README.md`の「環境変数」セクションを参照してください。

主要な環境変数:
- `REDIS_URL`: Redis接続URL
- `SLACK_WEBHOOK_URL`: Slack Webhook URL
- `PRICE_THRESHOLD_YEN`: 価格閾値（円）
- `COLLECTIONS`: 複数コレクション設定（JSON形式）
- `PAGES`: ページ指定（後方互換性）

## デプロイ

詳細は`README.md`の「インフラ要件と推奨環境」セクションを参照してください。

推奨プラットフォーム:
- Fly.io
- Render
- AWS ECS Fargate / Google Cloud Run

