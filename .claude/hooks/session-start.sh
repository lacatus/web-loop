#!/usr/bin/env bash
# SessionStart hook: make sure dependencies are installed so the verify gate, OpenSpec CLI and
# Playwright MCP work immediately (important for fresh Claude Code on the web containers).
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null 2>&1
  fi
  pnpm install --frozen-lockfile >&2
fi

# Context for Claude at the start of every session.
cat <<'EOF'
web-loop: spec-driven worker ⇄ validator loop.
- Specs: openspec/ (list active changes: `openspec list`). New work: /opsx:propose → /build-feature <change> → /opsx:archive
- Gate: `pnpm verify` (use `pnpm verify:fast` while iterating). See CLAUDE.md.
EOF
