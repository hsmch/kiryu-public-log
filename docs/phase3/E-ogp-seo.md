# E. OGP / SEO 対応

## 概要

SNS でシェアされた際にプレビュー画像・説明文が表示されるようにする。各ページに適切なメタデータを設定する。

## 現状

`site/src/layouts/Layout.astro` には以下のみ：
- `<meta name="description">` — あり（デフォルト値あり）
- `<title>` — あり（ページごとに設定可能）
- OGP タグ — **なし**
- Twitter Card — **なし**
- canonical URL — **なし**
- favicon — SVG のみ

## 変更対象

- `site/src/layouts/Layout.astro` — OGP メタタグの追加
- `site/src/pages/council/[slug].astro` — 議員ページ固有の description
- `site/src/pages/sessions/[slug].astro` — 定例会ページ固有の description
- `site/src/pages/topics/[tag].astro` — トピックページ固有の description
- 各ページ — title / description props の設定

## やること

### Step 1: Layout.astro に OGP メタタグを追加

```astro
---
interface Props {
  title?: string;
  description?: string;
  ogImage?: string;
  path?: string;
}

const SITE_URL = "https://kiryu.co";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

const {
  title = "Kiryu Public Log",
  description = "桐生市の市政・議会の公開情報をわかりやすく整理してお届けするアーカイブサイト",
  ogImage = DEFAULT_OG_IMAGE,
  path = "",
} = Astro.props;

const canonicalUrl = `${SITE_URL}${path}`;
---

<head>
  <!-- 既存 -->
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content={description} />
  <title>{title}</title>

  <!-- 追加: canonical -->
  <link rel="canonical" href={canonicalUrl} />

  <!-- 追加: OGP -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Kiryu Public Log" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:locale" content="ja_JP" />

  <!-- 追加: Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImage} />
</head>
```

### Step 2: 各ページに description と path を設定

**議員ページ** (`council/[slug].astro`):
```astro
<Layout
  title={`${member.name} - Kiryu Public Log`}
  description={`${member.name}（${member.faction}）の投票行動・一般質問 | 桐生市議会`}
  path={`/council/${slug}`}
/>
```

**定例会ページ** (`sessions/[slug].astro`):
```astro
<Layout
  title={`${session.session} - Kiryu Public Log`}
  description={`${session.session}の議案${session.bills.length}件の採決結果・一般質問 | 桐生市議会`}
  path={`/sessions/${slug}`}
/>
```

**トピックページ** (`topics/[tag].astro`):
```astro
<Layout
  title={`${tag} - Kiryu Public Log`}
  description={`桐生市議会における「${tag}」に関する議案・一般質問の一覧`}
  path={`/topics/${tag}`}
/>
```

**トップページ** (`index.astro`):
```astro
<Layout
  description="桐生市の市政・議会の公開情報をわかりやすく整理してお届けするアーカイブサイト"
  path="/"
/>
```

### Step 3: デフォルト OG 画像の作成

シンプルなテキストベースの OG 画像（1200x630px）を作成：
- 背景: 白
- テキスト: "Kiryu Public Log" + "桐生市の市政・議会情報を、わかりやすく"
- `site/public/og-default.png` に配置

### Step 4: （オプション）動的 OG 画像

将来的に `satori` で議員名・定例会名を動的に埋め込んだ OG 画像を生成する余地を残す。Phase 3 では静的デフォルト画像のみで十分。

### Step 5: 検証

- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) で OGP プレビューを確認
- [Twitter Card Validator](https://cards-dev.twitter.com/validator) で表示を確認
- Google の Rich Results Test でメタデータを確認

## 完了条件

- [ ] 全ページに `og:title`, `og:description`, `og:url`, `og:image` が設定されている
- [ ] Twitter Card メタタグが設定されている
- [ ] canonical URL が全ページに設定されている
- [ ] デフォルト OG 画像が `/og-default.png` に配置されている
- [ ] 議員ページ・定例会ページで固有の description が出力される
