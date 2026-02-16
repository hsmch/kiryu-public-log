# Kiryu Public Log 情報拡充計画

## Context

現在のサイトは議員名簿・議案一覧・新着情報のみで情報が薄い。「議会での具体的な発言」「議員別の活動一覧」「歳入歳出データ」を追加してサイトの価値を高める。

## 調査で判明した重要事項

- **一般質問通告一覧はPDFのみ**で公開（HTMLには PDFリンクしかない）
- **基金の状況はHTMLテーブル**で公開（パース容易）
- **予算額はPDF内**にあり、HTMLには直接含まれない

## 実装する3機能（順序）

### Feature C: 財政データ（最も単純、独立）
### Feature A: 一般質問スクレイパー（PDF解析が必要）
### Feature B: 議員詳細ページ（Feature A のデータを活用）

---

## Feature C: 財政データ — `feature/finance-data`

### 新規/変更ファイル
| ファイル | 操作 |
|---------|------|
| `pipeline/src/scrape-finance.ts` | 新規: 基金状況 HTML テーブルのスクレイパー |
| `data/finance/funds.json` | 新規: 基金残高データ |
| `site/src/lib/data.ts` | 変更: `FundsData` 型 + `getFunds()` 追加 |
| `site/src/pages/finance.astro` | 新規: まちの数字ページ |
| `site/src/layouts/Layout.astro` | 変更: ナビに「まちの数字」追加 |
| `pipeline/package.json` | 変更: `scrape:finance` スクリプト追加 |
| `.github/workflows/collect.yml` | 変更: `scrape:finance` ステップ追加 |

### データソース
- URL: `https://www.city.kiryu.lg.jp/shisei/zaisei/1007004.html`
- 2つの `<table>` (一般会計 + 特別会計等)
- 金額形式: `4,507,054,762円` → parseAmount でカンマ・円除去

### データ構造
```typescript
interface Fund { name: string; balance: number; category: "一般会計" | "特別会計等" }
interface FundsData {
  sourceUrl: string; scrapedAt: string; asOf: string;
  funds: Fund[]; generalTotal: number; specialTotal: number; grandTotal: number;
}
```

### 表示: `/finance`
- 基金残高合計のサマリカード（約161億円 等）
- 一般会計・特別会計のテーブル
- 公式サイトへの原文リンク

---

## Feature A: 一般質問スクレイパー — `feature/questions-scraper`

### 新規/変更ファイル
| ファイル | 操作 |
|---------|------|
| `pipeline/src/scrape-questions.ts` | 新規: PDFリンク収集 + PDF解析 |
| `data/questions/*.json` | 新規: 定例会ごとの一般質問データ |
| `site/src/lib/data.ts` | 変更: `QuestionsData` 型 + `getQuestionsForSession()` 等 |
| `site/src/pages/sessions/[slug].astro` | 変更: 一般質問セクション追加 |
| `pipeline/package.json` | 変更: `pdf-parse` 依存追加, `scrape:questions` 追加 |
| `.github/workflows/collect.yml` | 変更: ステップ追加 |

### 処理フロー
1. 一般質問インデックスページから年度ページリンクを収集
2. 各年度ページからPDFリンクを抽出（約44ファイル、H27〜R7）
3. PDFをダウンロード → `pdf-parse` でテキスト抽出
4. 議員名・質問項目・要旨をパース
5. `data/questions/{sessionSlug}.json` に保存

### データ構造
```typescript
interface QuestionItem { title: string; details: string[] }
interface MemberQuestion { memberName: string; order: number; items: QuestionItem[] }
interface QuestionsData {
  session: string; sessionSlug: string; sourceUrl: string; scrapedAt: string;
  questions: MemberQuestion[];
}
```

### 表示: `/sessions/[slug]` に追加
- `<details>/<summary>` 折りたたみで議員ごとの質問を表示
- PDF原文リンクを併記

### 新規依存: `pdf-parse`（軽量、テキスト抽出特化）

### リスク
- PDFテキスト抽出の品質は実際のPDFに依存
- 年度によりPDFフォーマットが異なる可能性
- → まず最新数年分でプロトタイプ、古い年度は追加対応

---

## Feature B: 議員詳細ページ — `feature/council-detail`

### 新規/変更ファイル
| ファイル | 操作 |
|---------|------|
| `site/src/pages/council.astro` → `site/src/pages/council/index.astro` | 移動 |
| `site/src/pages/council/[slug].astro` | 新規: 議員詳細ページ |
| `site/src/lib/romaji.ts` | 新規: ひらがな→ローマ字変換（自前実装） |
| `site/src/lib/data.ts` | 変更: `nameToSlug()`, `getMemberBySlug()`, `getQuestionsForMember()` |

### URLスラッグ
- nameReading → ローマ字変換: `いいじま　ひでき` → `iijima-hideki`
- ヘボン式、長音処理 (`ou→o`, `uu→u`)
- 外部ライブラリ不使用（自前変換テーブル）

### 表示: `/council/[slug]`
- プロフィール（写真、会派、委員会、当選回数）
- 一般質問一覧（Feature A のデータから議員名で抽出、定例会ごとに表示）
- 議案採決態度（votingRecordPdfUrl のあるセッションのPDFリンク一覧）

### `/council/index.astro` の変更
- 各議員カードを詳細ページへのリンクに変更

---

## 検証方法

各 Feature ごと:
1. スクレイパーを実行し、data/ にJSONが正しく出力されるか確認
2. `cd site && npm run build` でビルドエラーがないことを確認
3. `npx astro dev` で該当ページの表示を目視確認（Playwright snapshot）
4. 2回目のスクレイパー実行で既存データが壊れないことを確認
