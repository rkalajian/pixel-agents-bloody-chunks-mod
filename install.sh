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
MOD_SRC="$(cd "$(dirname "$0")" && pwd)/blood-explosion.js"
MOD_DEST="$WEBVIEW_DIR/assets/blood-explosion.js"
BACKUP="$HTML.bak"

echo "==> Checking for existing installation..."
if grep -q "blood-explosion" "$HTML" 2>/dev/null; then
  echo "    Mod already installed. Nothing to do."
  exit 0
fi
echo "    Not installed. Proceeding."

echo "==> Detecting main bundle filename..."
BUNDLE=$(grep -oE 'src="\.\/assets\/index-[^"]+\.js"' "$HTML" | head -1 | grep -oE 'index-[^"]+\.js')
if [ -z "$BUNDLE" ]; then
  echo "ERROR: could not find main bundle script tag in $HTML"
  exit 1
fi
echo "    Bundle: $BUNDLE"

echo "==> Backing up index.html..."
cp "$HTML" "$BACKUP"
echo "    Saved: $BACKUP"

echo "==> Copying mod script..."
cp "$MOD_SRC" "$MOD_DEST"
echo "    Installed: $MOD_DEST"

echo "==> Patching index.html..."
tmp=$(mktemp)
sed "s|src=\"\./assets/${BUNDLE}\"|src=\"./assets/blood-explosion.js\"></script>\n    <script type=\"module\" crossorigin src=\"./assets/${BUNDLE}\"|" "$HTML" > "$tmp"
mv "$tmp" "$HTML"
echo "    Injected <script> tag before $BUNDLE"

echo ""
echo "Done. blood-explosion mod installed."
echo "Reload the pixel-agents panel in VS Code to activate."
