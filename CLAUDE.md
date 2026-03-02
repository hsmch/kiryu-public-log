# CLAUDE.md - Kiryu Public Log プロジェクトコンテキスト

## プロジェクト概要

- **サービス名**: Kiryu Public Log（略称: KPL）
- **URL**: kiryu.co
- **リポジトリ**: hsmch/kiryu-public-log
- **運営**: 細道（hsmch） - 個人事業主の事業の一つとして運営
- **目的**: 桐生市の市政・議会の公開情報を自動収集・構造化し、市民にわかりやすく公開する中立的なアーカイブサイト

## 設計方針

- 更新はなるべく自動化し、人手をかけない運用を目指す
- AI要約には「AI要約」であることを明示し、原文リンクを必ず併記する
- 中立的なアーカイブとして、情報の加工は最小限にとどめる
- 公式情報への入り口となる位置づけ（サイト内で完結させない）

## 技術スタック

- **サイト**: Astro 5（静的サイト生成）、Tailwind CSS v4、Chart.js、pagefind
- **ホスティング**: Cloudflare Pages
- **パイプライン**: tsx、cheerio、pdf-parse、xlsx、zod、@anthropic-ai/sdk
- **データ収集**: GitHub Actions（`.github/workflows/collect.yml`、毎日 6:00 JST）
- **データ解析**: Claude Haiku（タグ分類）+ ルールベースフォールバック
- **データ保存**: JSON（data/ ディレクトリ）

## リポジトリ構成

```
hsmch/kiryu-public-log/
├── site/          # Astro 静的サイト
├── pipeline/      # スクレイパー・データ収集パイプライン
├── data/          # 構造化された JSON データ
├── scripts/       # ユーティリティスクリプト
├── docs/          # ドキュメント
├── screenshots/   # スクリーンショット
└── .claude/rules/ # パス条件付き Claude ルール
```

## データソース

桐生市公式サイト (city.kiryu.lg.jp) から以下を収集:

| データ | 件数 | 更新頻度 |
|--------|------|----------|
| 議員名簿 | 22名 | 選挙・役職改選時 |
| 定例会・臨時会の議案 | 68会期分 | 年4回定例会 + 臨時会 |
| 議員別投票記録 | 46会期分 | 定例会ごと |
| 一般質問 | 43会期分 | 定例会ごと |
| 予算・財政 | R03-R05経年 + 当年度 | 年1-2回 |
| 人口推移 | 1920-2020 | 国勢調査 |
| 新着情報・日程 | 随時 | 毎日自動チェック |

## サイト構成

| パス | 概要 |
|------|------|
| `/` | トップ（データハイライト、最新の動き） |
| `/sessions/[slug]` | 定例会詳細（議案一覧・投票マトリクス） |
| `/council/[slug]` | 議員詳細（投票記録・質問一覧） |
| `/finance` | 予算・財政ダッシュボード |
| `/analysis` | 投票パターン分析（ヒートマップ） |
| `/topics/[tag]` | テーマ別タイムライン |
| `/search` | サイト内検索（pagefind） |
| `/about` | サイト趣旨・運営者情報 |
| `/guide` | ガイド |
| `/rss.xml` | RSS フィード |

## Git ワークフロー

- **main**: 本番ブランチ。直接 push しない。変更は必ず PR 経由でマージ
- **feature/xxx**: main から作成する作業ブランチ
- **auto/data-update**: GitHub Actions がデータ更新 PR を自動作成

### ブランチ命名規則

- `feature/xxx` — 新機能・改善
- `fix/xxx` — バグ修正
- `chore/xxx` — 設定・ドキュメント等
- `auto/xxx` — GitHub Actions 自動生成

## 運用コスト

- ホスティング（Cloudflare Pages）: 無料
- ドメイン: 年数千円
- Claude API（タグ分類）: 月数百円
- GitHub Actions: 無料枠内
