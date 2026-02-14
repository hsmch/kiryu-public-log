# Kiryu Public Log

桐生市の市政・議会情報を自動収集し、わかりやすく公開するアーカイブサイト。

🌐 **https://kiryu.co**

## About

Kiryu Public Log（KPL）は、桐生市が公開している議会・市政情報を収集・構造化し、市民が簡単にアクセスできる形で提供するプロジェクトです。

- 議案・採決結果を一覧で確認
- 議員の活動記録を横断的に閲覧
- 予算・財政データの可視化
- すべての情報に公式ページへのリンクを併記

## Tech Stack

- **Site**: [Astro](https://astro.build/)（静的サイト生成）
- **Hosting**: Cloudflare Pages
- **Data Collection**: Node.js / GitHub Actions
- **Data Processing**: Claude API
- **Data Format**: JSON

## Project Structure

```
├── site/          # Astro サイト本体
├── pipeline/      # データ収集パイプライン
├── data/          # 構造化データ (JSON)
├── scripts/       # ユーティリティ
└── CLAUDE.md      # プロジェクトコンテキスト
```

## Development

```bash
# サイトの開発サーバー起動
cd site
npm install
npm run dev

# データ収集パイプラインの実行
cd pipeline
npm install
npm run collect
```

## Data Sources

- [桐生市議会](https://www.city.kiryu.lg.jp/shigikai/index.html)
- [桐生市 財政状況](https://www.city.kiryu.lg.jp/shisei/zaisei/index.html)
- [桐生市 統計情報](https://www.city.kiryu.lg.jp/shisei/1018369/index.html)

## License

MIT

## Author

[細道 / hsmch](https://github.com/hsmch)
