# Kiryu Public Log - 次のステップ

CLAUDE.md を読んだ上で、以下のタスクを順番に進めてください。

---

## Step 1: Astro サイトの初期セットアップ

`site/` ディレクトリに Astro プロジェクトを作成する。

- `npm create astro@latest` で site/ 配下に初期化
- TypeScript 有効
- Cloudflare Pages 向けのアダプター設定（`@astrojs/cloudflare`）
- Tailwind CSS の導入
- 日本語の基本レイアウト（lang="ja"）
- トップページに仮のヒーローセクション（サイト名・説明文・coming soon的な内容）

## Step 2: 議員名簿スクレイパーの作成

`pipeline/` ディレクトリにデータ収集の仕組みを作る。まず議員名簿から。

- Node.js（TypeScript）で作成
- 対象URL: `https://www.city.kiryu.lg.jp/shigikai/about/1003765.html`
- HTMLをfetch → パースして以下を抽出:
  - 議席番号、氏名（漢字・ふりがな）、会派、常任委員会、役職（委員長・副委員長等）、当選回数、写真URL
- 議長・副議長の情報も取得
- 結果を `data/council-members.json` に保存
- エラーハンドリングとログ出力

## Step 3: 議案・採決結果スクレイパーの作成

- 桐生市議会サイトの議案ページ構造を調査
- 定例会ごとの議案一覧・採決結果をパース
- `data/sessions/` 配下に定例会ごとのJSONとして保存
- データ構造の例:
  ```json
  {
    "session": "令和7年第2回定例会",
    "date": "2025-06",
    "bills": [
      {
        "number": "議案第○号",
        "title": "...",
        "proposer": "市長",
        "result": "可決",
        "votes": { "for": 20, "against": 0 }
      }
    ]
  }
  ```

## Step 4: 新着情報の差分検知

- `https://www.city.kiryu.lg.jp/shigikai/index.html` の「新着更新情報」セクションを定期チェック
- 前回取得分との差分を検出
- 新規エントリを `data/updates.json` に追記
- 各エントリのリンク先URLも保存

## Step 5: サイトにデータを表示

data/ のJSONを読み込んでAstroのページとして表示する。

- `/council` - 議員一覧ページ（写真・会派・委員会でフィルタリング可能）
- `/sessions` - 定例会一覧 → 各定例会の議案・採決結果
- `/` トップページに最新の更新情報タイムラインを表示
- 全ページに公式サイトへの原文リンクを併記
- レスポンシブ対応（モバイルファースト）

## Step 6: GitHub Actions で定期実行

- `.github/workflows/collect.yml` を作成
- スケジュール: 毎日1回（or 週1回）
- pipeline のスクレイパーを実行 → data/ を更新 → コミット & プッシュ
- data/ の変更があればサイトを再ビルド & デプロイ

## Step 7: Cloudflare Pages デプロイ設定

- `site/` をビルドして Cloudflare Pages にデプロイ
- カスタムドメイン kiryu.co の設定
- ビルドコマンドとアウトプットディレクトリの指定

---

## 補足: 技術的な注意事項

- 桐生市サイトへのリクエストは礼儀正しく（適切な間隔、User-Agent明記）
- 会議録検索システム（ssp.kaigiroku.net）は robots.txt でクロール拒否されているのでアクセスしない
- スクレイピング対象のHTML構造が変わった場合にエラーで気づけるようにする
- data/ のJSONにはスキーマバリデーションを入れておくと安心

## 補足: 今後の拡張（Phase 2以降）

- 市議会だよりPDFの解析（Claude API）
- YouTube議会中継の文字起こし・要約
- 予算・財政データのダッシュボード
- テーマ別の横断タグ付け
- `/about` ページ（サイトの趣旨・中立性方針・運営者情報）
