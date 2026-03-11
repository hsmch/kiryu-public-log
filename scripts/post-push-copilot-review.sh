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

# main/master ブランチへの push はスキップ
current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$current_branch" == "main" ]] || [[ "$current_branch" == "master" ]]; then
  exit 0
fi

# push 先が main/master の場合もスキップ（refspec: "HEAD:main", 引数: "git push origin main"）
read -r -a push_tokens <<< "$command"
for token in "${push_tokens[@]}"; do
  [[ "$token" == -* || "$token" == "git" || "$token" == "push" ]] && continue
  if [[ "$token" == "main" || "$token" == "master" || "$token" == *":main" || "$token" == *":master" ]]; then
    exit 0
  fi
done

# PRが存在するか確認
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || true)

if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

# 既に Copilot レビュー依頼済みならスキップ
COPILOT_REVIEWER="copilot-pull-request-reviewer[bot]"
existing=$(gh pr view "$PR_NUMBER" --json reviewRequests \
  --jq '[.reviewRequests[].login] | join("\n")' 2>/dev/null || true)
if echo "$existing" | grep -qF "$COPILOT_REVIEWER"; then
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
