# テストツール

## テストファイル一覧

### `test-config.js`
設定の読み込みを確認するテスト

```bash
node tests/test-config.js
```

### `test-pages.js`
動的ページ数検出機能のテスト

```bash
node tests/test-pages.js
```

### `test-multi-collection.js`
複数コレクション設定のテスト

```bash
COLLECTIONS='[{"name":"PMCG","base":"...","pages":[1,2,3],"priority":"hot"}]' node tests/test-multi-collection.js
```

### `simulate.js`
単一商品の在庫・価格変動シミュレーション

```bash
PRICE_THRESHOLD_YEN=1000 PAGES=1,2,3 node tests/simulate.js
```

その後、oneshotを実行して通知を確認:

```bash
PRICE_THRESHOLD_YEN=1000 PAGES=1,2,3 node src/oneshot.js
```

### `simulate-multi.js`
複数商品の在庫・価格変動シミュレーション

```bash
PRICE_THRESHOLD_YEN=1000 node tests/simulate-multi.js
```

その後、oneshotを実行して通知を確認:

```bash
PRICE_THRESHOLD_YEN=1000 PAGES=1,2,3 node src/oneshot.js
```

## テストシナリオ

### シミュレーションで設定される変動パターン

1. **在庫増加（0→1）**: `BackInStock`通知
2. **価格上昇**: `PriceChanged`通知
3. **在庫+価格変動**: `PriceChanged`通知
4. **再入荷（0→1）**: `BackInStock`通知
5. **在庫増加（複数）**: `StockIncreased`通知

### 確認ポイント

- Redisへの状態書き込みが正常に動作するか
- 各イベントタイプが正しく検知されるか
- Slack通知が正しく送信されるか
- 重複通知が防止されているか

