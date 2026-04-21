#!/usr/bin/env bash
set -euo pipefail

# Locate the extension dir regardless of installed version
EXT_DIR=$(ls -d "${HOME}/.vscode/extensions/pablodelucca.pixel-agents-"* 2>/dev/null | sort -V | tail -1)
if [ -z "$EXT_DIR" ]; then
  echo "ERROR: pixel-agents extension not found in $HOME/.vscode/extensions/"
  exit 1
fi

WEBVIEW_DIR="$EXT_DIR/dist/webview"
HTML="$WEBVIEW_DIR/index.html"
MOD_SRC="$(cd "$(dirname "$0")" && pwd)/blood-explosion.js"
MOD_DEST="$WEBVIEW_DIR/assets/blood-explosion.js"
BACKUP="$HTML.bak"

if grep -q "blood-explosion" "$HTML" 2>/dev/null; then
  echo "Mod already installed."
  exit 0
fi

# Detect the hashed bundle filename from the HTML
BUNDLE=$(grep -oE 'src="\.\/assets\/index-[^"]+\.js"' "$HTML" | head -1 | grep -oE 'index-[^"]+\.js')
if [ -z "$BUNDLE" ]; then
  echo "ERROR: could not find main bundle script tag in $HTML"
  exit 1
fi

# Backup original
cp "$HTML" "$BACKUP"
echo "Backed up index.html → index.html.bak"

# Copy mod script
cp "$MOD_SRC" "$MOD_DEST"
echo "Copied blood-explosion.js → $MOD_DEST"

# Inject script tag BEFORE the main bundle (portable sed, no -i '' macOS-ism)
tmp=$(mktemp)
sed "s|src=\"\./assets/${BUNDLE}\"|src=\"./assets/blood-explosion.js\"></script>\n    <script type=\"module\" crossorigin src=\"./assets/${BUNDLE}\"|" "$HTML" > "$tmp"
mv "$tmp" "$HTML"

echo "Patched index.html — blood-explosion mod installed."
echo "Reload the pixel-agents panel in VS Code to activate."
