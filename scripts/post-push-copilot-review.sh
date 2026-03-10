#!/usr/bin/env bash
# PostToolUse hook: git push 後に自動で Copilot レビューを依頼する
# stdin から hook input JSON を受け取る

set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command')
exit_code=$(echo "$input" | jq -r '.tool_response.exitCode')

# git push 以外、または失敗時はスキップ
if [[ "$command" != git\ push* ]] || [ "$exit_code" != "0" ]; then
  exit 0
fi

# main ブランチへの push はスキップ
current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$current_branch" == "main" ]] || [[ "$current_branch" == "master" ]]; then
  exit 0
fi

# PRが存在するか確認
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || true)

if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

# Copilot レビューを依頼
if gh pr edit "$PR_NUMBER" --add-reviewer "copilot-pull-request-reviewer[bot]" >/dev/null 2>&1; then
  jq -n --arg pr_number "$PR_NUMBER" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("PR #" + $pr_number + " に Copilot レビューを自動依頼しました。")
    }
  }'
else
  jq -n --arg pr_number "$PR_NUMBER" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("PR #" + $pr_number + " への Copilot レビュー依頼に失敗しました。")
    }
  }'
fi
