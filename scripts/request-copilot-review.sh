#!/usr/bin/env bash
# GitHub Copilot にPRレビューを依頼するスクリプト
# 使い方: scripts/request-copilot-review.sh

set -euo pipefail

# PRが存在するか確認
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || true)

if [ -z "$PR_NUMBER" ]; then
  echo "現在のブランチにPRが存在しません。スキップします。"
  exit 0
fi

# Copilot レビューを依頼
echo "PR #${PR_NUMBER} に Copilot レビューを依頼しています..."
gh pr edit "$PR_NUMBER" --add-reviewer "copilot-pull-request-reviewer[bot]"

echo "Copilot レビューを依頼しました。"
