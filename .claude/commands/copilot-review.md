# Copilot レビュー依頼

現在のブランチに紐づく PR に GitHub Copilot のコードレビューを依頼する。

## 手順

1. `gh pr view --json number` で現在のブランチの PR 番号を取得する（PR が見つからなければ中止）
2. `scripts/request-copilot-review.sh` を実行して Copilot レビューを依頼する
3. 結果をユーザーに報告する
