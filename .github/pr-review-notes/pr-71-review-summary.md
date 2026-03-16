# レビュー指摘の修正可否まとめ (PR #71)

> PRプレビューデプロイ自動化に対するレビュー指摘への対応判断

## 対応済み

| 指摘 | 対応内容 | コミット |
|------|----------|----------|
| スクリプトインジェクション | `${{ }}` → `env` + `process.env` に変更 | dc6d89a |
| 冗長な `if: success()` | 削除 | dc6d89a |
| concurrency 未設定 | `ci-${{ github.head_ref }}` グループ追加 | dc6d89a |
| ページネーション不足 | `per_page: 100` 追加 | dc6d89a |
| デプロイ失敗で CI 失敗 | `continue-on-error: true` 追加 | dc6d89a |
| wrangler の `--branch` 引数が `${{ }}` 直接展開 | `env.BRANCH_NAME` 経由に変更 | 5cdb1c7 |
| `issues: write` 権限が未設定 | `permissions` に `issues: write` を追加 | (次コミット) |
| `--branch=$BRANCH_NAME` 未クオート | `--branch="$BRANCH_NAME"` に変更 | (次コミット) |

## 未対応（対応不要と判断）

| 指摘 | 判断 | 理由 |
|------|------|------|
| composite action に抽出 | **不要** | 利用箇所が2つだけで抽象化は過剰 |
| `sticky-pull-request-comment` 導入 | **不要** | 外部依存を増やすほどの規模ではない（現状30行程度） |
| SHA ピニング | **スコープ外** | 既存ワークフロー全体で major version tag を使用中。やるなら全ワークフロー一括で |
| `per_page: 100` でも足りない場合 | **許容** | 100コメント超のPRは極めてまれ。完全なページネーションは過剰 |
| `context.issue.number` の非PR時ガード | **不要** | `on: pull_request` トリガーのみなので non-PR イベントは起きない |
| コメントID永続化（artifact等） | **不要** | マーカーコメント方式で十分実用的 |
| concurrency グループに PR 番号を含める | **不要** | fork PR はこのリポジトリでは想定外（個人プロジェクト） |
| `permissions` をジョブレベルに移動 | **不要** | validate-data は `read` のみで実害なし。ジョブが2つだけなので分割は過剰 |
| `continue-on-error` 失敗時の通知 | **許容** | プレビューは任意機能。失敗してもビルド結果には影響しない |
