#!/bin/bash
# usage: refcheck.sh  -> builds each task's ref/ solution in a temp dir and scores it.
# Prints one SCORE line per task and exits 1 unless every task has full marks.
B="$(cd "$(dirname "$0")" && pwd)"
ok=0
for t in $(ls "$B/tasks"); do
  d=$(mktemp -d) || exit 1
  "$B/prep.sh" "$t" "$d" >/dev/null && cp "$B/tasks/$t/ref/"* "$d/"
  line=$("$B/score.sh" "$d"); echo "$line"
  set -- $(echo "$line" | sed -E 's/.*unit=([0-9]+)\/([0-9]+) integration=([0-9]+)\/([0-9]+).*/\1 \2 \3 \4/')
  [ "$#" -eq 4 ] && [ "$1" = "$2" ] && [ "$3" = "$4" ] && [ "$4" -gt 0 ] || ok=1
  rm -rf "$d"
done
exit $ok
