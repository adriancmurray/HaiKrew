#!/bin/sh
# Release HaiKrew: set the version, run the checks and make it main (scripts/try.sh), then push main to GitHub.
# The installed plugin already reads the main checkout's folder, so no `claude plugin update` is needed here.
#
# Usage: scripts/release.sh <version> <message file>
#   The message file holds the commit message; its first line should start with the version.
set -eu

[ $# -eq 2 ] || { echo "usage: $0 <version> <message file>" >&2; exit 2; }
version=$1
message=$2
here=$(git rev-parse --show-toplevel)
main=$(git -C "$here" worktree list --porcelain | awk '/^worktree /{print $2; exit}')
cd "$here"

sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$version\"/" plugin/.claude-plugin/plugin.json
if ! grep -q "\"version\": \"$version\"" plugin/.claude-plugin/plugin.json; then echo "version not set" >&2; exit 1; fi
git add -A plugin README.md scripts .claude-plugin
# This machine's home and temp paths, built here so the script never matches itself.
private="/Users/$(id -un)/|/private/tmp/|claude-$(id -u)"
if git grep --cached -nE "$private" -- plugin README.md scripts .claude-plugin ':!scripts/release.sh'; then
  echo "a private path is staged" >&2
  exit 1
fi
git diff --cached --check
git commit -q -F "$message"
"$here/scripts/try.sh" --keep-version
git -C "$main" push -q origin main
echo "released $(git -C "$main" log --oneline -1 origin/main)"
