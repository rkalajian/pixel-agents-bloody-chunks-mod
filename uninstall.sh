#!/usr/bin/env bash
set -euo pipefail

echo "==> Locating pixel-agents extension..."
EXT_DIR=$(ls -d "${HOME}/.vscode/extensions/pablodelucca.pixel-agents-"* 2>/dev/null | sort -V | tail -1)
if [ -z "$EXT_DIR" ]; then
  echo "ERROR: pixel-agents extension not found in $HOME/.vscode/extensions/"
  exit 1
fi
echo "    Found: $EXT_DIR"

WEBVIEW_DIR="$EXT_DIR/dist/webview"
HTML="$WEBVIEW_DIR/index.html"
BACKUP="$HTML.bak"
MOD_DEST="$WEBVIEW_DIR/assets/blood-explosion.js"

echo "==> Checking for backup..."
if [ ! -f "$BACKUP" ]; then
  echo "ERROR: No backup found at $BACKUP — mod may not be installed."
  exit 1
fi
echo "    Found: $BACKUP"

echo "==> Restoring original index.html..."
cp "$BACKUP" "$HTML"
echo "    Restored: $HTML"

echo "==> Removing mod files..."
rm -f "$BACKUP"
echo "    Deleted: $BACKUP"
rm -f "$MOD_DEST"
echo "    Deleted: $MOD_DEST"

echo ""
echo "Done. blood-explosion mod removed."
echo "Reload the pixel-agents panel in VS Code to deactivate."
