---
paths:
  - "pipeline/**"
---

# pipeline/ 開発ガイド

## 技術スタック

- tsx, cheerio, pdf-parse, xlsx, zod, @anthropic-ai/sdk

## スクレイパー共通パターン

- **User-Agent**: `"KiryuPublicLog/1.0 (+https://kiryu.co)"`
- **リクエスト間隔**: `REQUEST_INTERVAL_MS = 1000`（1 秒）
- **差分実行**: セッション単位でファイル存在チェック → 既存データはスキップ

## Zod スキーマ

- 全スキーマは `src/schemas.ts` で定義
- **`.passthrough()`** を全スキーマに適用（未知フィールド許可で将来互換性を確保）
- バリデーション → JSON 保存の流れ

## タグ生成（generate-tags.ts）

- **一次**: Claude Haiku（`claude-haiku-4-5-20251001`）バッチ分類（30 件/バッチ）
- **フォールバック**: ルールベース正規表現（API 失敗時 or API キー未設定時）
- 13 カテゴリ: 財政, 教育, 福祉・医療, 子育て, 防災・安全, 都市基盤, 環境, 産業・観光, まちづくり, デジタル化, 条例, 人事・組織, 議会運営
- 差分更新: 既存タグは再利用、新規エントリのみ API 呼び出し

## 桐生市サイト HTML の特性

- `<br>` 区切りのフィールド → `splitByBr()` でパース
- 新フォーマット（h2 カテゴリ + テーブル）と旧フォーマット（カテゴリ別ページ）の両対応
- `\u00a0`（non-breaking space）を含むことがある → `.replace(/\u00a0/g, " ")` で正規化

## 名前マッチ

- `normalizeName()`: `name.replace(/[\s\u3000]+/g, "")` で全角・半角空白を除去して比較
- 投票記録 PDF: 既知姓リスト（1-3 文字）による分割ロジック（`KNOWN_*_FAMILIES`）

## セッションスラグ形式

`{era}{year}-{number}-{type}` — 例: `r7-1-teireikai`, `r5-1-rinjikai`
- era: `r`（令和）/ `h`（平成）、元年 = 1
- number: `第N回` → N、なし → 0
- type: `teireikai`（定例会）/ `rinjikai`（臨時会）

## 金額単位

- **基金** (`funds.json`): 円（整数そのまま）
- **予算経年** (`budget-history.json`): 歳入・歳出 = 千円単位 / `fundBalance` = 百万円単位
- **解析時の共通パターン**: カンマ・「円」「人」「世帯」等の単位文字を除去 → parseInt
