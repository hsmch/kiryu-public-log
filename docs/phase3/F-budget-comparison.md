# F. 予算の経年比較

## 概要

現在の `/finance` は単年度のスナップショット（人口・予算内訳・基金残高）のみ。複数年度の予算推移を可視化し、「桐生市の財政がどう変わってきたか」を見えるようにする。

## 現状

### 既存データ
- `data/finance/budget.json` — 単年度の歳入歳出内訳
- `data/finance/funds.json` — 基金残高（単年度）
- `data/population.json` — 人口推移（2000年〜、複数年度あり）

### 既存ページ
- `/finance` — SVG チャート（人口推移、歳入内訳、歳出内訳）と基金テーブル

## データソース

### 群馬県「市町村財政状況資料集」

- 群馬県サイトで Excel 形式で公開
- 市町村別の財政指標が含まれる
- 年1回更新（決算確定後、通常翌年度秋）

### 取得可能な指標

| 指標 | 内容 | 比較の意義 |
|------|------|----------|
| 一般会計歳入決算額 | 市税・地方交付税・国庫支出金等の合計 | 財政規模の推移 |
| 一般会計歳出決算額 | 民生費・教育費・土木費等の合計 | 支出構造の変化 |
| 経常収支比率 | 経常的経費の財源充当率 | 財政の硬直度 |
| 財政力指数 | 基準財政収入額/基準財政需要額 | 自立度 |
| 実質公債費比率 | 借金返済の負担割合 | 将来負担 |
| 基金残高 | 貯金の推移 | 財政の余裕度 |

## やること

### Step 1: データ調査

1. 群馬県サイトで桐生市の財政状況資料集の URL を確認
2. Excel ファイルの構造（シート名、列名、データ範囲）を確認
3. 何年分のデータが取得可能か確認

### Step 2: データ取得スクリプトの作成

`pipeline/src/scrape-budget-history.ts`:

- Excel ファイルをダウンロード
- 桐生市の行を抽出
- 必要な指標を構造化

```typescript
interface BudgetHistoryEntry {
  fiscalYear: number;       // 年度（例: 2024）
  revenue: number;          // 歳入決算額
  expenditure: number;      // 歳出決算額
  ordinaryBalanceRatio: number;  // 経常収支比率（%）
  fiscalStrengthIndex: number;   // 財政力指数
  debtServiceRatio: number;      // 実質公債費比率（%）
  fundBalance: number;      // 基金残高
}

interface BudgetHistoryData {
  sourceUrl: string;
  scrapedAt: string;
  entries: BudgetHistoryEntry[];
}
```

出力: `data/finance/budget-history.json`

### Step 3: 依存ライブラリの追加

Excel パースに `xlsx`（SheetJS）を使用：

```bash
cd pipeline && npm install xlsx
```

### Step 4: finance ページの拡張

`site/src/pages/finance.astro` に経年チャートセクションを追加：

- 歳入・歳出推移の折れ線グラフ（SVG、既存の人口グラフと同様のアプローチ）
- 経常収支比率の推移グラフ
- （オプション）近隣市との比較テーブル

### Step 5: data.ts に関数追加

```typescript
export function getBudgetHistory(): BudgetHistoryData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "finance", "budget-history.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

## 更新頻度

- 決算データは年1回確定（翌年度秋頃）
- 半手動運用で十分（年1回 `scrape:budget-history` を実行）
- CI に追加する場合は月1回程度で十分

## リスク

- 群馬県サイトの Excel フォーマットが年度によって異なる可能性
- データが PDF でのみ公開されている年度がある可能性
- → まず直近5年分で実装し、古い年度は段階的に対応

## 完了条件

- [ ] `data/finance/budget-history.json` に複数年度の財政データが格納されている
- [ ] `/finance` ページに歳入歳出の経年推移チャートが表示される
- [ ] 経常収支比率 or 財政力指数の推移が可視化されている
- [ ] データソースへのリンクが記載されている
