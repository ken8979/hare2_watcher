# スクリプト

## generate-collections-env.js

コレクション設定をJSONファイルから読み込んで、`.env`ファイル用の`COLLECTIONS`環境変数を生成します。

### 使用方法

1. `collections-config.json`を編集してコレクション設定を更新
2. スクリプトを実行して環境変数を生成:

```bash
# 環境変数を標準出力に表示
node scripts/generate-collections-env.js

# 環境変数をファイルに保存
node scripts/generate-collections-env.js >> .env

# macOSでクリップボードにコピー
node scripts/generate-collections-env.js | pbcopy
```

### collections-config.json の形式

```json
[
  {
    "name": "コレクション名",
    "base": "https://www.hareruya2.com/collections/xxx?filter.v.availability=1&sort_by=price-descending",
    "pages": "all",
    "priority": "normal"
  }
]
```

**設定項目:**
- `name`: コレクション名（ログ表示用）
- `base`: コレクションのベースURL（在庫あり・価格降順でフィルタ）
- `pages`: ページ指定
  - `"all"` または `"*"`: 全ページを自動検出（推奨）
  - `"1-53"`: 範囲指定（1から53まで）
  - `[1,2,3]`: 配列で明示的に指定
- `priority`: 優先度
  - `"hot"`: 高頻度（HOT_INTERVAL_SEC間隔、デフォルト60秒）
  - `"normal"`: 中頻度（WARM_INTERVAL_SEC間隔、デフォルト60秒）
  - `"cold"`: 低頻度（COLD_INTERVAL_SEC間隔、デフォルト60秒）

