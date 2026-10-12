#!/bin/sh
# Install or refresh "haikrew-dev": the HaiKrew pane, band and agent tools from this checkout, as a mod beside an
# installed haikrew. It registers /haikrew-dev and keeps its own settings and ledger; it has no gate and no guards,
# so nothing doubles up with the installed copy. Run it again after every change to plugin/src.
#
# Usage: scripts/dev-mod.sh <mods folder>
#   <mods folder> is the one the plugin-authoring skill names for this session, e.g. ~/.claude/dev-mods/<session id>.
#   The session reloads the mod by itself once hot reloading is on.
set -eu

[ $# -eq 1 ] || { echo "usage: $0 <mods folder>" >&2; exit 2; }
repo=$(cd "$(dirname "$0")/.." && pwd)
dest="$1/haikrew-dev"

mkdir -p "$dest/.claude-plugin" "$dest/hooks"
printf '%s\n' '{ "name": "haikrew-dev", "version": "0.0.1", "description": "Development copy of the HaiKrew pane (/haikrew-dev); no gate or guards." }' \
  > "$dest/.claude-plugin/plugin.json"
printf '%s\n' '{ "modules": ["./register.ts"] }' > "$dest/hooks/hooks.json"
cp "$repo/scripts/dev-mod/register.ts" "$dest/hooks/register.ts"
# The engine does not follow a symlinked src, so the sources are copied.
rsync -a --delete --exclude '*.test.ts' --exclude 'cli.ts' --exclude 'squeeze.ts' "$repo/plugin/src/" "$dest/src/"
# A failed validation stops the script; the pipe through tail would otherwise hide its exit status.
out=$(claude plugin validate "$dest" 2>&1) || { printf '%s\n' "$out" >&2; exit 1; }
printf '%s\n' "$out" | tail -1
