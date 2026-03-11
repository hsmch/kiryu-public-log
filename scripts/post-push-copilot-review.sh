#!/usr/bin/env bash
# PostToolUse hook: git push 後に自動で Copilot レビューを依頼する
# stdin から hook input JSON を受け取る

set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command')
exit_code=$(echo "$input" | jq -r '.tool_response.exitCode')

# git push 以外、または失敗時はスキップ（サイレント）
if [[ "$command" != git\ push* ]] || [ "$exit_code" != "0" ]; then
  exit 0
fi

# ヘルパー: スキップ理由を出力して終了
skip_with_reason() {
  local msg="[copilot-review hook] スキップ: $1"
  jq -n --arg msg "$msg" '{
    systemMessage: $msg,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $msg
    }
  }'
  exit 0
}

# main/master ブランチへの push はスキップ
current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$current_branch" == "main" ]] || [[ "$current_branch" == "master" ]]; then
  skip_with_reason "main/master ブランチへの push"
fi

# push 先が main/master の場合もスキップ（refspec: "HEAD:main", 引数: "git push origin main"）
read -r -a push_tokens <<< "$command"
for token in "${push_tokens[@]}"; do
  [[ "$token" == -* || "$token" == "git" || "$token" == "push" ]] && continue
  if [[ "$token" == "main" || "$token" == "master" || "$token" == *":main" || "$token" == *":master" ]]; then
    skip_with_reason "push 先が main/master"
  fi
done

# PRが存在するか確認
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || true)

if [ -z "$PR_NUMBER" ]; then
  skip_with_reason "PR が存在しない"
fi

# 既に Copilot レビュー依頼済みならスキップ
COPILOT_REVIEWER="copilot-pull-request-reviewer[bot]"
existing=$(gh pr view "$PR_NUMBER" --json reviewRequests \
  --jq '[.reviewRequests[].login] | join("\n")' 2>/dev/null || true)
if echo "$existing" | grep -qF "$COPILOT_REVIEWER"; then
  skip_with_reason "既に Copilot レビュー依頼済み (PR #$PR_NUMBER)"
fi

# Copilot レビューを依頼
if gh pr edit "$PR_NUMBER" --add-reviewer "copilot-pull-request-reviewer[bot]" >/dev/null 2>&1; then
  msg="[copilot-review hook] PR #$PR_NUMBER に Copilot レビューを自動依頼しました。"
  jq -n --arg msg "$msg" '{
    systemMessage: $msg,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $msg
    }
  }'
else
  msg="[copilot-review hook] PR #$PR_NUMBER への Copilot レビュー依頼に失敗しました。"
  jq -n --arg msg "$msg" '{
    systemMessage: $msg,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $msg
    }
  }'
fi
