---
paths:
  - "site/**"
---

# site/ 開発ガイド

## アーキテクチャ

- Astro 5 + Cloudflare Pages（ほぼ全ページを `export const prerender = true` で静的生成し、`/search` は SSR）
- Tailwind CSS v4（`@tailwindcss/vite` プラグイン経由、`global.css` は `@import "tailwindcss"` のみ）
- pagefind: ビルド後に `npx pagefind --site dist` で自動インデックス生成

## データ読み込み

- `src/lib/data.ts` が全データ読み込みの中心（30+ 関数）
- `../data/` の JSON を `resolve(process.cwd(), "../data")` で読む
- ビルド時に data/ の JSON を読むため、**ファイル不在だとビルド失敗**する
- `getFunds()`, `getBudgetHistory()` 等は **null を返す可能性あり**（必ず null チェック）

## ページの共通パターン

- 動的ルート: `getStaticPaths()` + `export const prerender = true`
- `src/layouts/Layout.astro`: OGP/SEO meta タグ、ナビゲーション、`<main data-pagefind-body>`
- `src/lib/romaji.ts`: 議員名ひらがな → URL スラグ変換（ヘボン式ローマ字）

## ビジュアライゼーションの使い分け

- **Chart.js**（+ chartjs-plugin-annotation）: 予算ドーナツ、経年棒グラフ・折れ線、財政指標ライン — インラインの `<script>` タグで JSON データを渡して初期化
- **SVG 手書き**: 人口推移折れ線、投票分析ヒートマップ、テーマ別スパークライン — Astro テンプレート内で直接描画

## 主要ページ

| パス | ファイル | 概要 |
|------|----------|------|
| `/` | `index.astro` | トップ（onboarding バナー、データハイライト） |
| `/sessions/[slug]` | `sessions/[slug].astro` | 定例会詳細（議案テーブル、投票マトリクス） |
| `/council/[slug]` | `council/[slug].astro` | 議員詳細 |
| `/finance` | `finance.astro` | 予算・財政ダッシュボード |
| `/analysis` | `analysis.astro` | 投票パターン分析（SVG ヒートマップ） |
| `/topics/[tag]` | `topics/[tag].astro` | テーマ別タイムライン |
| `/search` | `search.astro` | pagefind 検索 |
| `/rss.xml` | `rss.xml.ts` | RSS フィード |
