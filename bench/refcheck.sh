#!/bin/bash
# usage: refcheck.sh [task...]  -> runs the hidden suite against the reference solution (expect all pass)
# and against the untouched starter (expect failures: proves the suite is not vacuous).
B="$(cd "$(dirname "$0")" && pwd)"
for t in ${@:-$(ls "$B/tasks")}; do
  "$B/prep.sh" "$t" REF >/dev/null; cp "$B/tasks/$t/ref/"* "$B/runs/$t/REF/"; "$B/score.sh" "$t" REF
  "$B/prep.sh" "$t" START >/dev/null; "$B/score.sh" "$t" START
done
