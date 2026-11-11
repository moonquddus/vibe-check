#!/usr/bin/env bash
set -euo pipefail

label=com.mmt.vibe-check
repo="$(cd "$(dirname "$0")/.." && pwd)"
logs=("$HOME/Library/Logs/vibe-check.log" "$HOME/Library/Logs/vibe-check.launchd.log")

touch "${logs[@]}"
"$repo/scripts/install-launchd.sh" >/dev/null || { read -rp "Press Enter to close."; exit 1; }

stop() {
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  echo "Stopped $label."
}
trap stop EXIT

uv run --quiet --project "$repo" python -m vibe_check.watch "${logs[@]}"
