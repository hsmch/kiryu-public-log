#!/usr/bin/env bash
# PostToolUse hook: Edit/Write 後にドキュメント更新の必要性をチェック
# stdin から JSON を受け取り、変更ファイルのパスを解析する

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# ファイルパスが取得できない場合は何もしない
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# パスを正規化: 絶対パスからリポジトリルート以降を抽出
# 例: /Users/user/dev/repo/site/src/pages/foo.astro → site/src/pages/foo.astro
FILE_PATH=$(echo "$FILE_PATH" | sed 's|.*/kiryu-public-log/||')

# ドキュメントファイル自体の編集は無視
case "$FILE_PATH" in
  CLAUDE.md|*/CLAUDE.md|.claude/rules/*|*/.claude/rules/*|.claude/commands/*|*/.claude/commands/*|.claude/skills/*|*/.claude/skills/*|docs/*|*/docs/*|README.md|*/README.md)
    exit 0
    ;;
esac

# チェック対象のパスパターン
DOC_CHECK_NEEDED=false
REASON=""

case "$FILE_PATH" in
  site/src/pages/*|*/site/src/pages/*)
    DOC_CHECK_NEEDED=true
    REASON="ページファイルの変更 — CLAUDE.md のサイト構成や .claude/rules/site.md のページ一覧が最新か確認"
    ;;
  site/astro.config.mjs|*/site/astro.config.mjs)
    DOC_CHECK_NEEDED=true
    REASON="Astro 設定の変更 — CLAUDE.md の技術スタックや .claude/rules/site.md のアーキテクチャが最新か確認"
    ;;
  pipeline/src/schemas.ts|*/pipeline/src/schemas.ts)
    DOC_CHECK_NEEDED=true
    REASON="スキーマの変更 — .claude/rules/data.md のスキーマ記述が最新か確認"
    ;;
  pipeline/src/*.ts|*/pipeline/src/*.ts)
    DOC_CHECK_NEEDED=true
    REASON="パイプラインの変更 — .claude/rules/pipeline.md の記述が最新か確認"
    ;;
  .github/workflows/*|*/.github/workflows/*)
    DOC_CHECK_NEEDED=true
    REASON="CI ワークフローの変更 — CLAUDE.md のデータ収集の記述が最新か確認"
    ;;
  site/package.json|*/site/package.json|pipeline/package.json|*/pipeline/package.json|package.json|*/package.json)
    DOC_CHECK_NEEDED=true
    REASON="依存パッケージの変更 — CLAUDE.md の技術スタックが最新か確認"
    ;;
esac

if [ "$DOC_CHECK_NEEDED" = true ]; then
  jq -n --arg reason "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("[doc-update-check] " + $reason)
    }
  }'
fi
