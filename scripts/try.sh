#!/bin/sh
# Make this branch's committed work the HaiKrew that runs, without pushing: run the checks, then fast-forward the
# main checkout's `main` to this branch. The installed plugin is read from the main checkout's plugin/ folder (a
# folder marketplace), so `/reload-plugins` in any session then runs it. There is no separate development copy.
#
# Usage: scripts/try.sh            (from a worktree or the main checkout, with the work committed)
set -eu

here=$(git rev-parse --show-toplevel)
main=$(git -C "$here" worktree list --porcelain | awk '/^worktree /{print $2; exit}')
branch=$(git -C "$here" branch --show-current)
cd "$here"

if [ -n "$(git status --porcelain -- plugin README.md scripts .claude-plugin)" ]; then
  echo "uncommitted changes under plugin/, scripts/ or the READMEs: commit them first" >&2
  exit 1
fi

log=$(mktemp)
# A failed check stops here: each is tested with an explicit if, since a negated command never trips set -e.
if ! claude plugin test plugin > "$log" 2>&1; then tail -30 "$log"; exit 1; fi
if grep -q "^(fail)" "$log"; then grep "^(fail)" "$log" >&2; exit 1; fi
tail -1 "$log"
if ! claude plugin validate plugin > "$log" 2>&1; then cat "$log"; exit 1; fi
tail -1 "$log"
if ! node --test tests/squeeze.spec.ts > "$log" 2>&1; then tail -20 "$log"; exit 1; fi
rm -f "$log"

if [ "$here" != "$main" ]; then
  if [ -n "$(git -C "$main" status --porcelain)" ]; then echo "the main checkout has local changes: $main" >&2; exit 1; fi
  if [ "$(git -C "$main" branch --show-current)" != main ]; then echo "the main checkout is not on main" >&2; exit 1; fi
  git -C "$main" merge --ff-only -q "$branch"
fi
echo "main is at $(git -C "$main" log --oneline -1). Run /reload-plugins to use it; nothing was pushed."
