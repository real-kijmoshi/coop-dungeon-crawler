#!/bin/sh
# Coop Dungeon Crawler - one-line launcher.
#   curl -fsSL __BASE__/play | sh
# Downloads the client the first time (cached in ~/.cache), then starts the game.
set -e

BASE="__BASE__"
SERVER="__SERVER__"

say() { printf '\033[38;2;255;200;110m%s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

fetch() { # fetch URL [OUTFILE]
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$2" ]; then curl -fL --progress-bar "$1" -o "$2"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -n "$2" ]; then wget -q --show-progress -O "$2" "$1"; else wget -qO- "$1"; fi
  else
    die "curl or wget is required"
  fi
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported system $(uname -s). On Windows run in PowerShell:  irm $BASE/play.ps1 | iex" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported CPU $(uname -m)" ;;
esac

dir="${XDG_CACHE_HOME:-$HOME/.cache}/coop-dungeon-crawler"
bin="$dir/cdc"
mkdir -p "$dir"

remote=$(fetch "$BASE/dl/version" 2>/dev/null || echo "")
local_ver=$(cat "$dir/version" 2>/dev/null || echo "")
if [ ! -x "$bin" ] || { [ -n "$remote" ] && [ "$remote" != "$local_ver" ]; }; then
  say "⚔  Downloading Coop Dungeon Crawler ($os/$arch)..."
  fetch "$BASE/dl/cdc-$os-$arch" "$bin.tmp" || die "download failed"
  chmod +x "$bin.tmp"
  mv "$bin.tmp" "$bin"
  [ -n "$remote" ] && echo "$remote" > "$dir/version"
fi

[ -r /dev/tty ] || die "no terminal available - run this in an interactive terminal"
exec "$bin" -server "$SERVER" </dev/tty
