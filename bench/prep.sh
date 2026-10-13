#!/bin/bash
# usage: prep.sh <task> <setup>  -> creates runs/<task>/<setup>/ with starter files + spec.md
B="$(cd "$(dirname "$0")" && pwd)"
d="$B/runs/$1/$2"; rm -rf "$d"; mkdir -p "$d"
cp "$B/tasks/$1/starter/"* "$d/"; cp "$B/tasks/$1/spec.md" "$d/"
echo "$d"
