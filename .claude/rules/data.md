---
paths:
  - "data/**"
---

# data/ ガイド

## ディレクトリ構成

```
data/
├── council-members.json    # 議員名簿（議長・副議長 + 22 名）
├── population.json         # 人口推移（1920-2020 国勢調査）
├── updates.json            # 市議会サイト新着情報
├── schedule.json           # 議会日程
├── tags.json               # AI タグ分類結果（method: claude-api / rule-based）
├── voting-analysis.json    # 投票パターン分析（合意マトリクス）
├── sessions/{slug}.json    # 定例会・臨時会の議案一覧（68 件）
├── voting/{slug}.json      # 議員別投票記録（46 件）
├── questions/{slug}.json   # 一般質問（43 件）
└── finance/
    ├── budget.json          # 当年度予算（歳入・歳出内訳）
    ├── budget-history.json  # 予算経年比較（R03-R05）
    ├── budget-annotations.json  # 予算科目の解説
    ├── benchmarks.json      # 財政指標の全国平均・基準値
    └── funds.json           # 基金残高
```

## 命名規則

- sessions/, voting/, questions/ のファイル名は **セッションスラグ**: `{era}{year}-{number}-{type}.json`
  - 例: `r5-2-teireikai.json` = 令和5年第2回定例会

## 共通フィールド

- `sourceUrl` / `sourceUrls`: 全ファイル必須。データの出典 URL
- `scrapedAt`: スクレイプ実行時刻（ISO 8601）
- 日付: `YYYY-MM-DD` 形式
- 金額: 原則として整数（円）。`finance/budget-history.json` の金額は千円単位、`fundBalance` は百万円単位

## tags.json

- `method`: `"claude-api"` または `"rule-based"`（生成方法を記録）
- `entries[].type`: `"bill"` または `"question"`
- `entries[].tags`: 1-3 個のカテゴリ配列

## スキーマ定義

全データのスキーマは `pipeline/src/schemas.ts` で Zod により定義。
