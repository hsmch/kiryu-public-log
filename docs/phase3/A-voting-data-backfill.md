# A. 投票データの全件スクレイプ

## 概要

投票行動の可視化機能（賛否マトリクス、議員別投票履歴）は実装済みだが、68セッション中1件（r7-4-teireikai）しかデータがない。既存スクレイパーを全セッションに対して実行し、データを埋める。

## 現状

- `pipeline/src/scrape-voting-records.ts` — 実装済み・動作確認済み
- `data/voting/` — r7-4-teireikai.json のみ（1件）
- `data/sessions/*.json` — 68ファイルに `votingRecordPdfUrl` が存在
- PDF URL パターン: `https://www.city.kiryu.lg.jp/_res/projects/default_project/_page_/001/{id}/{filename}.pdf`

## やること

### Step 1: 全セッション分のスクレイプ実行

```bash
cd pipeline && npm run scrape:voting
```

スクレイパーは `data/sessions/*.json` を走査し、`votingRecordPdfUrl` があるセッションを対象にPDFをダウンロード・パースする。1秒間隔のレート制限あり。

### Step 2: 年代別パース品質の確認

PDF のフォーマットは年度によって異なる可能性がある。以下をサンプルチェック：

| 年代 | 代表セッション | 確認ポイント |
|------|---------------|------------|
| 令和5〜7年 | r7-4, r6-2, r5-3 | 現行フォーマット（動作確認済み） |
| 令和1〜4年 | r4-4, r2-3, r1-2 | フォーマット差異の有無 |
| 平成29〜31年 | h31-1, h30-2, h29-3 | 旧フォーマット対応 |
| 平成24〜28年 | h28-2, h26-3, h24-4 | 最古のデータ |

### Step 3: パース失敗の修正

エラーが出たセッションについて：
1. PDF をローカルでダウンロードして中身を確認
2. テーブル構造の差異を特定
3. `scrape-voting-records.ts` のパースロジックを調整
   - 議員名の正規表現: `/^[\u4E00-\u9FAF\u3040-\u309F]+[\s　][\u4E00-\u9FAF\u3040-\u309F]+$/`
   - 議案番号パターン: `/^(議案|報告|請願|陳情|発議案)第/`
   - 投票シンボル: `○/〇/×/✕/欠/議長/退`

### Step 4: データ検証

```bash
# 生成されたファイル数の確認
ls data/voting/ | wc -l
# 期待値: 68（全セッション分）

# 各ファイルの records 数が 0 でないことを確認
for f in data/voting/*.json; do
  echo "$f: $(jq '.records | length' "$f") records"
done
```

### Step 5: ビルド確認

```bash
cd site && npm run build
```

- 議員詳細ページ (`/council/[slug]`) で投票サマリが表示されること
- 定例会ページ (`/sessions/[slug]`) で賛否マトリクスが表示されること

## 既存スクレイパーの動作仕様

- PDF ごとに議員名ヘッダー行を検出（4名以上の名前パターンが並ぶ行）
- 議案行を検出し、各議員の投票シンボルを抽出
- 投票結果を自動計算: 全会一致 / 賛成多数 / 反対多数
- 出力: `data/voting/{sessionSlug}.json`

## 出力データ構造

```typescript
{
  session: "令和7年第4回定例会",
  sessionSlug: "r7-4-teireikai",
  sourceUrl: "https://...",
  scrapedAt: "2026-02-25T...",
  records: [
    {
      billNumber: "議案第95号",
      billTitle: "令和7年度桐生市一般会計補正予算（第5号）",
      result: "原案可決",
      votes: [
        { memberName: "飯島　英規", vote: "反対" },
        { memberName: "人見　武男", vote: "賛成" },
        // ...
      ]
    }
  ]
}
```

## リスク

- 古い年度の PDF はテーブルレイアウトが異なり、パース失敗する可能性がある
- 一部の PDF がテキスト抽出不可（画像PDF）の場合は対応不可
- → まず実行して成功率を確認し、失敗分を個別対応する方針

## 完了条件

- [ ] 全68セッション分のスクレイプが実行されている
- [ ] パース成功率 90% 以上（残りは個別対応 or 見送り）
- [ ] `npm run build` が正常完了する
- [ ] 議員詳細ページで投票履歴が複数セッション分表示される
