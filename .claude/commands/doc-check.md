# ドキュメント整合性チェック

現在のブランチで変更されたファイルをもとに、ドキュメントの整合性を確認し、必要に応じて更新する。

## 手順

1. `git diff main --name-only` で main ブランチからの変更ファイル一覧を取得する
2. 変更内容を分析し、以下のドキュメントとの整合性をチェックする:
   - **CLAUDE.md** — プロジェクト概要、技術スタック、サイト構成、データソース
   - **.claude/rules/site.md** — ページ一覧、アーキテクチャ
   - **.claude/rules/pipeline.md** — スクレイパーパターン、タグ生成
   - **.claude/rules/data.md** — データ構成、スキーマ
3. 不整合がある場合は修正案を提示し、承認を得てから更新する
4. 不整合がなければ「ドキュメントは最新です」と報告する

## チェック項目

| 変更対象 | チェックするドキュメント |
|----------|------------------------|
| site/src/pages/ の追加・削除 | CLAUDE.md サイト構成、rules/site.md ページ一覧 |
| package.json の依存変更 | CLAUDE.md 技術スタック |
| pipeline/src/ の変更 | rules/pipeline.md |
| data/ のスキーマ変更 | rules/data.md |
| .github/workflows/ の変更 | CLAUDE.md データ収集 |
| astro.config.mjs の変更 | CLAUDE.md、rules/site.md |

## 注意事項

- ドキュメントの変更は最小限にとどめる（実態と合わない部分のみ修正）
- 軽微な UI 調整やバグ修正のみの場合は「更新不要」と判断してよい
