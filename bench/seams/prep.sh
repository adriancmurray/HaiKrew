#!/bin/bash
# usage: prep.sh <task> <dir>  -> copies seed/ and spec-*.md into <dir> (created if missing).
# hidden/ and ref/ are never copied. <dir> must be absent or empty, so nothing is overwritten.
B="$(cd "$(dirname "$0")" && pwd)"
[ -d "$B/tasks/$1/seed" ] || { echo "no such task: $1" >&2; exit 1; }
[ -d "$2" ] && [ -n "$(ls -A "$2")" ] && { echo "dir not empty: $2" >&2; exit 1; }
mkdir -p "$2" && cp "$B/tasks/$1/seed/"* "$2/" && cp "$B/tasks/$1/spec-"[abc].md "$2/" && echo "$1" > "$2/.seams-task" && echo "$2"
