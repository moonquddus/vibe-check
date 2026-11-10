#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
target="$app/mods/auto-reviewer"
key="${1:-cmd-alt-r}"

install_to() {
  mkdir -p "$1"
  cp "$repo/herdr-mod/main.js" "$repo/herdr-mod/mod.json" "$1/"
  python3 -c 'import json, sys; print(f"export const REPO = {json.dumps(sys.argv[1])};\nexport const LABEL = {json.dumps(sys.argv[2])};")' "$2" "$3" > "$1/install.js"
}

# herdr-app check runs the mod once, so check a copy with a stub runner, not the real one
check="$(mktemp -d)"
trap 'rm -rf "$check"' EXIT
mkdir -p "$check/repo/scripts"
printf '#!/bin/sh\n' > "$check/repo/scripts/install-launchd.sh"
chmod +x "$check/repo/scripts/install-launchd.sh"
install_to "$check/mod" "$check/repo" com.mmt.auto-reviewer.check
herdr-app check "$check/mod"

install_to "$target" "$repo" com.mmt.auto-reviewer
rm -f "$target/repo.js"

python3 - "$app/keys.json" "$key" <<'PY'
import json, sys
from pathlib import Path

path, key = Path(sys.argv[1]), sys.argv[2]
keys = json.loads(path.read_text()) if path.exists() else {}
action = {"command": "pane.split", "args": {"direction": "right", "mod": "auto-reviewer"}}
bound = keys.setdefault("global", {}).get(key)
if bound in (None, action):
    keys["global"][key] = action
    path.write_text(json.dumps(keys, indent=2) + "\n")
    print(f"Press {key} in Herdr to open the panel.")
else:
    print(f"{key} is already bound to {bound}. Run again with a free key, for example: scripts/install-herdr-mod.sh cmd-alt-shift-r")
PY
echo "Installed the auto-reviewer mod in $target"
