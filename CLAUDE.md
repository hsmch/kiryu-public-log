# CLAUDE.md - Kiryu Public Log (KPL)

桐生市の市政・議会の公開情報を自動収集・構造化し公開する中立的アーカイブサイト。
リポジトリ: hsmch/kiryu-public-log / URL: kiryu.co（仮: kiryu-public-log.pages.dev）

## コマンド

### サイト開発
```
npm --prefix site install        # 依存インストール
npm --prefix site run dev        # 開発サーバー起動
npm --prefix site run build      # 本番ビルド
npm --prefix site run test:e2e   # E2Eテスト (Playwright)
```

### パイプライン
```
npm --prefix pipeline install
npm --prefix pipeline run scrape:members      # 議員名簿
npm --prefix pipeline run scrape:sessions     # 議案
npm --prefix pipeline run scrape:voting       # 投票記録
npm --prefix pipeline run scrape:questions    # 一般質問
npm --prefix pipeline run scrape:updates      # 新着情報
npm --prefix pipeline run scrape:finance      # 財政データ
npm --prefix pipeline run scrape:schedule     # 議会日程
npm --prefix pipeline run scrape:population   # 人口推移
npm --prefix pipeline run scrape:budget-history # 予算経年
npm --prefix pipeline run scrape:minutes      # 議事録
npm --prefix pipeline run generate:tags       # AIタグ生成（ANTHROPIC_API_KEY必要）
npm --prefix pipeline run generate:summaries  # 会期要約生成
npm --prefix pipeline run generate:announcements # お知らせ生成
npm --prefix pipeline run analyze:voting      # 投票パターン分析
npm --prefix pipeline run validate            # データバリデーション
```

### データフロー
```
pipeline(scrape) → data/*.json → site(build) → Cloudflare Pages
```

## 技術スタック

- **サイト**: Astro 5（静的サイト生成）、Tailwind CSS v4、Chart.js、pagefind
- **ホスティング**: Cloudflare Pages
- **パイプライン**: tsx、cheerio、pdf-parse、xlsx、zod、@anthropic-ai/sdk
- **データ収集**: GitHub Actions（`.github/workflows/collect.yml`、毎日 6:00 JST）
- **データ解析**: Claude Haiku（タグ分類）+ ルールベースフォールバック
- **データ保存**: JSON（data/ ディレクトリ）

## リポジトリ構成

```
├── site/          # Astro 静的サイト
├── pipeline/      # スクレイパー・データ収集パイプライン
├── data/          # 構造化された JSON データ
├── scripts/       # ユーティリティスクリプト
├── docs/          # ドキュメント
├── screenshots/   # スクリーンショット
└── .claude/rules/ # パス条件付き Claude ルール
```

## 設計上の注意

- AI要約には「AI要約」であることを明示し、原文リンクを必ず併記する
- 中立的なアーカイブとして、情報の加工は最小限にとどめる
- 環境変数: `ANTHROPIC_API_KEY` のみ（タグ生成・要約生成用、未設定時はルールベースにフォールバック）

詳細な技術ガイド・Gotchasは `.claude/rules/` のConditional Rulesを参照（該当パスの編集時に自動ロード）:
- `site.md` — Astro/Tailwind v4/pagefind/Chart.js の注意点、ページ一覧
- `pipeline.md` — スクレイパー共通パターン、タグ生成、HTML パース、スラグ形式
- `data.md` — ディレクトリ構成、命名規則、共通フィールド、スキーマ定義

## Git ワークフロー

- **main**: 本番ブランチ。直接 push しない。変更は必ず PR 経由でマージ
- **feature/xxx**: main から作成する作業ブランチ
- **auto/data-update**: GitHub Actions がデータ更新 PR を自動作成

### ブランチ命名規則

- `feature/xxx` — 新機能・改善
- `fix/xxx` — バグ修正
- `chore/xxx` — 設定・ドキュメント等
- `auto/xxx` — GitHub Actions 自動生成

### Git コマンドの実行ルール

- **git コマンドは常にリポジトリルートで実行する**（`cd` でサブディレクトリに移動しない）
