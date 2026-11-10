#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/auto-reviewer"

mkdir -p "$target"
cp "$repo/herdr-mod/main.js" "$repo/herdr-mod/mod.json" "$target/"
printf 'export const REPO = %s;\n' "$(printf '%s' "$repo" | python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))')" > "$target/repo.js"
herdr-app check "$target"
echo "Installed the auto-reviewer mod in $target"
