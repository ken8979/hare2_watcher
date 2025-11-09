# コレクション設定ガイド

## 概要

このプロジェクトでは、複数のコレクションを監視できます。コレクション設定は`collections-config.json`ファイルで管理し、`.env`ファイルの`COLLECTIONS`環境変数に反映します。

## セットアップ手順

### 1. collections-config.jsonを編集

`collections-config.json`ファイルを開き、監視したいコレクションを追加・編集します。

```json
[
  {
    "name": "MEGA",
    "base": "https://www.hareruya2.com/collections/mega?filter.v.availability=1&sort_by=price-descending",
    "pages": "all",
    "priority": "normal"
  }
]
```

### 2. 環境変数を生成

以下のコマンドで、`.env`ファイル用の`COLLECTIONS`環境変数を生成します:

```bash
# 環境変数を標準出力に表示（確認用）
node scripts/generate-collections-env.js

# 環境変数を.envファイルに追加
node scripts/generate-collections-env.js >> .env
```

### 3. .envファイルを確認

`.env`ファイルに以下のような行が追加されていることを確認:

```
COLLECTIONS=[{"name":"MEGA","base":"https://www.hareruya2.com/collections/mega?filter.v.availability=1&sort_by=price-descending","pages":"all","priority":"normal"},...]
```

### 4. アプリケーションを再起動

設定を反映するために、アプリケーションを再起動:

```bash
# PM2を使用している場合
pm2 restart hareruya2bot

# 直接実行している場合
npm start
```

## 設定項目の説明

### name
コレクション名（ログ表示用）。任意の文字列を指定できます。

例: `"MEGA"`, `"SV"`, `"PMCG"`

### base
コレクションのベースURL。在庫あり・価格降順でフィルタしたURLを指定します。

形式: `https://www.hareruya2.com/collections/{collection-handle}?filter.v.availability=1&sort_by=price-descending`

### pages
監視するページを指定します。

- `"all"` または `"*"`: 全ページを自動検出（推奨）
- `"1-53"`: 範囲指定（1から53まで）
- `[1,2,3]`: 配列で明示的に指定

### priority
監視の優先度を指定します。

- `"hot"`: 高頻度（HOT_INTERVAL_SEC間隔、デフォルト60秒）
- `"normal"`: 中頻度（WARM_INTERVAL_SEC間隔、デフォルト60秒）
- `"cold"`: 低頻度（COLD_INTERVAL_SEC間隔、デフォルト60秒）

## 現在の設定

現在、以下の16コレクションが設定されています:

1. MEGAシリーズ
2. スカーレット&バイオレット (SV)
3. ソード＆シールドシリーズ (SS)
4. サン＆ムーンシリーズ (SM)
5. XYシリーズ
6. BWシリーズ
7. LEGENDシリーズ
8. DPtシリーズ
9. DPシリーズ
10. PCGシリーズ
11. ADVシリーズ
12. eシリーズ
13. ★neoシリーズ
14. ★webシリーズ
15. ★VSシリーズ
16. PMCGシリーズ（優先度: hot）

## トラブルシューティング

### コレクションが検出されない

1. `.env`ファイルの`COLLECTIONS`環境変数が正しく設定されているか確認
2. JSONの構文エラーがないか確認（カンマ、引用符など）
3. アプリケーションのログを確認してエラーメッセージを確認

### ページ数が正しく検出されない

- `pages: "all"`を指定している場合、初回実行時に自動検出されます
- 検出に失敗した場合は、手動でページ数を指定してください

### 設定を変更したが反映されない

- アプリケーションを再起動してください
- `.env`ファイルが正しく読み込まれているか確認してください

