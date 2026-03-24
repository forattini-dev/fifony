#!/usr/bin/env bash
# Release readiness checklist — run before publishing a new version.
# Usage: bash scripts/release-check.sh
# Exit code 0 = all checks passed, non-zero = failed.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass=0
fail=0

check() {
  local label="$1"
  shift
  printf "  %-40s " "$label"
  if "$@" > /dev/null 2>&1; then
    printf "${GREEN}PASS${NC}\n"
    ((pass++))
  else
    printf "${RED}FAIL${NC}\n"
    ((fail++))
  fi
}

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Fifony Release Checklist"
echo "═══════════════════════════════════════════════════"
echo ""

echo "▶ Static checks"
check "pnpm lint" pnpm lint
check "pnpm typecheck" pnpm typecheck

echo ""
echo "▶ Build"
check "pnpm build" pnpm build

echo ""
echo "▶ Tests"
check "pnpm test" pnpm test

echo ""
echo "▶ Git"
check "no uncommitted changes" git diff --quiet HEAD
check "on main or develop" bash -c 'branch=$(git rev-parse --abbrev-ref HEAD); [[ "$branch" == "main" || "$branch" == "develop" ]]'

echo ""
echo "▶ Package"
check "version is set" node -e "const p = require('./package.json'); if (!p.version) process.exit(1)"
check "bin.fifony exists" node -e "const p = require('./package.json'); if (!p.bin?.fifony) process.exit(1)"

echo ""
echo "═══════════════════════════════════════════════════"
if [ "$fail" -gt 0 ]; then
  printf "  ${RED}✖ $fail check(s) failed, $pass passed${NC}\n"
  echo "═══════════════════════════════════════════════════"
  exit 1
else
  printf "  ${GREEN}✔ All $pass checks passed${NC}\n"
  echo "═══════════════════════════════════════════════════"
  exit 0
fi
