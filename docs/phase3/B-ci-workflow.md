# B. CI ワークフローの整備

## 概要

`.github/workflows/collect.yml` に未登録のスクレイパーが3つある。これらを追加し、データ収集の自動化を完成させる。

## 現状

### collect.yml に含まれているステップ
1. `scrape:members` — 議員名簿
2. `scrape:sessions` — 議案・採決結果
3. `scrape:updates` — 新着情報
4. `scrape:questions` — 一般質問
5. `scrape:finance` — 財政データ

### 未登録のスクレイパー
6. `scrape:voting` — 投票記録（PDFパース）
7. `scrape:schedule` — 議会日程
8. `scrape:population` — 人口データ

### 未登録のジェネレーター
9. `generate:tags` — タグ付け（スクレイプ後に実行すべき）

## 変更対象

- `.github/workflows/collect.yml`（このファイルのみ）

## 変更内容

### 追加するステップ

```yaml
      # 既存の scrape:finance の後に追加

      - name: Scrape voting records
        working-directory: pipeline
        run: npm run scrape:voting

      - name: Scrape schedule
        working-directory: pipeline
        run: npm run scrape:schedule

      - name: Scrape population
        working-directory: pipeline
        run: npm run scrape:population

      - name: Generate tags
        working-directory: pipeline
        run: npm run generate:tags
```

### 実行順序の考慮

```
scrape:members    — 議員名簿（他に依存なし）
scrape:sessions   — 議案（他に依存なし）
scrape:updates    — 新着情報（他に依存なし）
scrape:questions  — 一般質問（他に依存なし）
scrape:finance    — 財政（他に依存なし）
scrape:voting     — 投票記録（sessions のデータからPDF URLを取得するため sessions の後）
scrape:schedule   — 日程（他に依存なし）
scrape:population — 人口（他に依存なし）
generate:tags     — タグ付け（sessions と questions のデータを使うため最後）
```

### voting の差分実行について

`scrape-voting-records.ts` は全セッションを走査するが、既に `data/voting/{slug}.json` が存在するセッションはスキップするロジックの追加を検討する：

```typescript
// 案: 既存ファイルがあればスキップ
const existingFile = resolve(DATA_DIR, "voting", `${slug}.json`);
if (existsSync(existingFile)) {
  console.log(`[scrape-voting] Skip ${slug} (already exists)`);
  continue;
}
```

これにより日次実行時は新規セッション分のみ処理され、実行時間とサーバー負荷を削減できる。

### PR の add-paths

現在 `data/` のみだが、これで全データファイルがカバーされているので変更不要。

## deploy.yml との連動

現在の deploy.yml は collect ワークフロー完了時にトリガーされる設定。変更不要。

```yaml
on:
  workflow_run:
    workflows: ["Collect Data"]
    types: [completed]
```

## 完了条件

- [ ] collect.yml に voting, schedule, population, generate:tags の4ステップが追加されている
- [ ] 手動トリガー（workflow_dispatch）で全ステップが正常完了する
- [ ] 生成された PR に全データファイルの変更が含まれる
- [ ] voting スクレイパーに既存ファイルスキップロジックが入っている
