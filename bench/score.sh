#!/bin/bash
# usage: score.sh <task> <setup>  ->  "task setup vis=N/T hidden=P/T"
# run dir: runs/<task>/<setup>/ (see prep.sh)
B="$(cd "$(dirname "$0")" && pwd)"
cd "$B/runs/$1/$2" || exit 1
count() { local f=$1 o; o=$(timeout 180 node --test "$f" 2>&1); echo "$(echo "$o" | awk '/^# pass|^ℹ pass/{p=$NF} /^# tests|^ℹ tests/{t=$NF} END{print (p+0)"/"(t+0)}')"; }
v=$(count visible.test.ts)
cp "$B/tasks/$1/hidden.test.ts" ./hidden.test.ts
h=$(count hidden.test.ts)
rm -f hidden.test.ts
echo "$1 $2 vis=$v hidden=$h"
