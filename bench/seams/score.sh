#!/bin/bash
# usage: score.sh <dir>  -> "SCORE task=<t> unit=<p>/<n> integration=<p>/<n>"
# <dir> was made by prep.sh (it holds .seams-task). Each hidden suite is copied in, run, removed.
# n is the number of top-level test( calls in the hidden file, so a part that fails to load scores 0/n.
B="$(cd "$(dirname "$0")" && pwd)"
D="$(cd "$1" && pwd)" || exit 1
t=$(cat "$D/.seams-task") || exit 1
cd "$D" || exit 1
if command -v timeout >/dev/null 2>&1; then TO="timeout 180"
elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout 180"
else TO=""; echo "warning: no timeout or gtimeout on PATH; running without a time limit" >&2; fi
score_file() { # <hidden file name> -> "<passed> <total>"
  local f=$1 o p
  cp "$B/tasks/$t/hidden/$f" "./$f"
  o=$($TO node --test "./$f" 2>&1)
  rm -f "./$f"
  p=$(echo "$o" | awk '/^# pass|^ℹ pass/{print $NF}')
  echo "${p:-0} $(grep -c '^test(' "$B/tasks/$t/hidden/$f")"
}
up=0; un=0
for f in "$B/tasks/$t/hidden/"unit-*.test.ts; do
  read -r p n < <(score_file "$(basename "$f")"); up=$((up + p)); un=$((un + n))
done
read -r ip in < <(score_file integration.test.ts)
echo "SCORE task=$t unit=$up/$un integration=$ip/$in"
