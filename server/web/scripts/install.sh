#!/bin/sh
# Coop Dungeon Crawler - installer.
#   curl -fsSL __BASE__/install | sh
# Installs the `cdc` command and sets this server as the default.
set -e

BASE="__BASE__"
SERVER="__SERVER__"

say() { printf '\033[38;2;255;200;110m%s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fL --progress-bar "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q --show-progress -O "$2" "$1"
  else die "curl or wget is required"; fi
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported system $(uname -s). On Windows run in PowerShell:  irm $BASE/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported CPU $(uname -m)" ;;
esac

if [ -n "$CDC_INSTALL_DIR" ]; then
  dest="$CDC_INSTALL_DIR"
elif [ -w /usr/local/bin ]; then
  dest=/usr/local/bin
else
  dest="$HOME/.local/bin"
fi
mkdir -p "$dest"

say "⚔  Downloading Coop Dungeon Crawler ($os/$arch)..."
fetch "$BASE/dl/cdc-$os-$arch" "$dest/cdc.tmp" || die "download failed"
chmod +x "$dest/cdc.tmp"
mv "$dest/cdc.tmp" "$dest/cdc"

# Remember this server as the default for the login screen.
if [ "$(uname -s)" = "Darwin" ]; then
  cfg="$HOME/Library/Application Support/coop-dungeon-crawler"
else
  cfg="${XDG_CONFIG_HOME:-$HOME/.config}/coop-dungeon-crawler"
fi
mkdir -p "$cfg"
printf '%s\n' "$SERVER" > "$cfg/server"

say "Installed to $dest/cdc"
case ":$PATH:" in
  *":$dest:"*) say "Run it with:  cdc" ;;
  *) say "Add $dest to your PATH, or run:  $dest/cdc" ;;
esac
