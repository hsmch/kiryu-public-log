# Kiryu Public Log

桐生市の市政・議会情報を自動収集し、わかりやすく公開するアーカイブサイト。

🌐 **https://kiryu.co**

## About

Kiryu Public Log（KPL）は、桐生市が公開している議会・市政情報を収集・構造化し、市民が簡単にアクセスできる形で提供するプロジェクトです。

- 市の運営を「決める・お金・実行・人・関わる」の 5 分類で整理（未構造化の要素は公式ページへの入口を掲載）
- 議案・採決結果を一覧で確認
- 議員ごとの投票履歴・活動記録を横断的に閲覧
- 投票パターン分析（会派結束度・ヒートマップ）
- 予算・財政データの可視化（経年比較・Chart.js）
- 人口推移グラフ
- テーマ別タイムライン
- サイト内全文検索（pagefind）
- すべての情報に公式ページへのリンクを併記

## Tech Stack

- **Site**: [Astro](https://astro.build/)（静的サイト生成）+ Tailwind CSS
- **Hosting**: Cloudflare Pages
- **Data Collection**: TypeScript / [cheerio](https://cheerio.js.org/) / pdf-parse / xlsx
- **Data Processing**: Claude API（タグ付け・分類）
- **Data Validation**: [Zod](https://zod.dev/)（スキーマバリデーション）
- **Charts**: Chart.js / SVG
- **Search**: [pagefind](https://pagefind.app/)
- **Testing**: [Playwright](https://playwright.dev/)（スモークテスト）
- **CI/CD**: GitHub Actions
- **Data Format**: JSON

## Project Structure

```
├── site/          # Astro サイト本体
│   └── tests/     # Playwright スモークテスト
├── pipeline/      # データ収集パイプライン
│   └── src/       # スクレイパー・バリデーション・スキーマ
├── data/          # 構造化データ (JSON)
│   ├── sessions/  # 定例会・臨時会（議案・採決結果）
│   ├── voting/    # 議員別投票記録
│   ├── questions/ # 一般質問通告
│   └── finance/   # 予算・財政データ
└── CLAUDE.md      # プロジェクトコンテキスト
```

## Development

```bash
# サイトの開発サーバー起動
cd site
npm install
npm run dev

# サイトのビルド & スモークテスト
npm run build
npx playwright test
```

```bash
# データ収集パイプライン
cd pipeline
npm install

# 各スクレイパーの個別実行
npm run scrape:members       # 議員名簿
npm run scrape:sessions      # 議案・採決結果
npm run scrape:voting        # 議員別投票記録
npm run scrape:questions     # 一般質問通告
npm run scrape:schedule      # 議会日程
npm run scrape:population    # 人口データ
npm run scrape:finance       # 基金残高
npm run scrape:budget-history # 財政経年データ
npm run scrape:updates       # 新着情報
npm run generate:tags        # AI タグ付け (要 ANTHROPIC_API_KEY)
npm run analyze:voting       # 投票パターン分析

# データ品質チェック
npm run validate
```

### CI/CD

| ワークフロー | トリガー | 内容 |
|---|---|---|
| `collect.yml` | 毎日 6:00 JST | 全スクレイパー実行 → バリデーション → 自動 PR 作成 |
| `ci.yml` | PR 作成時 | サイトビルド + スモークテスト / データバリデーション |
| Copilot code review | PR 作成時 | GitHub Copilot による自動コードレビュー（Ruleset） |
| `deploy.yml` | main push 時 | サイトビルド → Cloudflare Pages デプロイ |

### Git Workflow

main への直接 push は行わず、feature ブランチから PR を作成してマージします。
データの定期収集も GitHub Actions が PR を自動作成します。

```
main ← PR ← feature/xxx        （手動の開発）
main ← PR ← auto/data-update   （GitHub Actions による自動データ更新）
```

## Data Sources

- [桐生市議会](https://www.city.kiryu.lg.jp/shigikai/index.html)
- [桐生市 財政状況](https://www.city.kiryu.lg.jp/shisei/zaisei/index.html)
- [桐生市 統計情報](https://www.city.kiryu.lg.jp/shisei/1018369/index.html)
- [群馬県 市町村財政状況資料集](https://www.pref.gunma.jp/page/6270.html)

## License

MIT

## Author

[細道 / hsmch](https://github.com/hsmch)
