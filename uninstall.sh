#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$HOME/.vscode/extensions/pablodelucca.pixel-agents-1.3.0"
WEBVIEW_DIR="$EXT_DIR/dist/webview"
HTML="$WEBVIEW_DIR/index.html"
BACKUP="$HTML.bak"
MOD_DEST="$WEBVIEW_DIR/assets/blood-explosion.js"

if [ ! -f "$BACKUP" ]; then
  echo "No backup found — mod may not be installed."
  exit 1
fi

cp "$BACKUP" "$HTML"
rm -f "$BACKUP" "$MOD_DEST"
echo "Restored original index.html — blood-explosion mod removed."
echo "Reload the pixel-agents panel in VS Code to deactivate."
