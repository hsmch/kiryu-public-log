# D. サイト内検索

## 概要

議案700件超、一般質問800件超のコンテンツがあるが横断検索の手段がない。静的サイト向けの検索機能を導入する。

## 技術選定

### pagefind（採用）

- Astro 公式ドキュメントで推奨
- ビルド後の HTML から自動でインデックス生成
- JS バンドルが小さい（〜15KB gzipped）
- 日本語対応済み（CJK 分割）
- Cloudflare Pages との相性良好（静的ファイルとしてデプロイ）

### 不採用候補
- Fuse.js: クライアント側で全データをロードするためデータ量に依存してパフォーマンスが低下
- Algolia: 外部サービス依存、無料枠の制限

## 変更対象

- `site/package.json` — pagefind 依存の追加
- `site/astro.config.mjs` — pagefind 統合設定
- `site/src/layouts/Layout.astro` — 検索 UI の追加
- `site/src/pages/search.astro` — 検索結果ページ（新規）

## やること

### Step 1: pagefind の導入

```bash
cd site && npm install -D pagefind @pagefind/default-ui
```

Astro の postbuild フックで pagefind を実行：

```javascript
// astro.config.mjs に追加
import { execSync } from "node:child_process";

export default defineConfig({
  // ...existing config
  integrations: [
    // ...existing integrations
    {
      name: "pagefind",
      hooks: {
        "astro:build:done": () => {
          execSync("npx pagefind --site dist/client --glob '**/*.html'");
        },
      },
    },
  ],
});
```

### Step 2: 検索ページの作成

`site/src/pages/search.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
---

<Layout title="検索 - Kiryu Public Log">
  <div class="mx-auto max-w-4xl px-4 py-8">
    <h1 class="text-2xl font-bold text-gray-900">検索</h1>
    <div id="search" class="mt-4"></div>
  </div>
</Layout>

<script>
  import { PagefindUI } from "@pagefind/default-ui";
  new PagefindUI({
    element: "#search",
    showSubResults: true,
    translations: {
      placeholder: "議案、議員名、キーワードで検索...",
      zero_results: "「[SEARCH_TERM]」に一致する結果はありません",
    },
  });
</script>

<style is:global>
  /* pagefind UI のスタイルカスタマイズ */
  .pagefind-ui__search-input {
    @apply rounded-lg border-gray-300;
  }
</style>
```

### Step 3: ヘッダーに検索リンクを追加

`site/src/layouts/Layout.astro` のナビゲーションに追加：

```html
<nav class="flex gap-4 text-sm">
  <a href="/council" class="text-gray-600 hover:text-gray-900">議員一覧</a>
  <a href="/sessions" class="text-gray-600 hover:text-gray-900">議案・採決</a>
  <a href="/finance" class="text-gray-600 hover:text-gray-900">まちの数字</a>
  <a href="/search" class="text-gray-600 hover:text-gray-900">検索</a>
  <a href="/about" class="text-gray-600 hover:text-gray-900">about</a>
</nav>
```

### Step 4: 検索対象の最適化

pagefind はデフォルトで全 HTML をインデックスするが、`data-pagefind-body` 属性で対象を絞れる：

- ヘッダー・フッターを除外（`data-pagefind-ignore`）
- メインコンテンツのみ対象（`<main>` に `data-pagefind-body`）

### Step 5: deploy.yml の確認

pagefind は `npm run build` の postbuild で実行されるため、deploy.yml の変更は不要。ビルド成果物に `_pagefind/` ディレクトリが含まれることを確認。

## 検索対象コンテンツ

| ページ | 検索可能な内容 |
|--------|--------------|
| `/council/[slug]` | 議員名、会派名、投票内容 |
| `/sessions/[slug]` | 議案タイトル、議案番号、一般質問タイトル |
| `/topics/[tag]` | トピック名、関連議案・質問 |
| `/finance` | 財政用語、基金名 |

## 完了条件

- [ ] pagefind が導入され、ビルド時にインデックスが生成される
- [ ] `/search` ページで日本語検索が動作する
- [ ] ヘッダーナビに検索リンクが追加されている
- [ ] ヘッダー・フッターが検索対象から除外されている
- [ ] Cloudflare Pages へのデプロイで検索が動作する
