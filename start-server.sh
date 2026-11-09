#!/usr/bin/env sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js LTS from https://nodejs.org then run this file again.' >&2
  exit 1
fi
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/start-server.js"
