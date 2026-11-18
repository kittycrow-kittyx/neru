#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/neru-guards.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT

# Analyse Neru's own working source and documentation, not pinned upstream
# repositories or generated build products. Include uncommitted local edits.
tar -C "$root" --exclude='./vendor' --exclude='./.git' \
  --exclude='./node_modules' --exclude='./dist' --exclude='./coverage' \
  --exclude='./build' --exclude='__pycache__' -cf - . | tar -C "$work" -xf -
ln -s "$root/node_modules" "$work/node_modules"
"$root/node_modules/.bin/code-guards" all --strict --include-tests --project "$work/tsconfig.guards.json"
