#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$HOME/.vscode/extensions/pablodelucca.pixel-agents-1.3.0"
WEBVIEW_DIR="$EXT_DIR/dist/webview"
HTML="$WEBVIEW_DIR/index.html"
MOD_SRC="$(cd "$(dirname "$0")" && pwd)/blood-explosion.js"
MOD_DEST="$WEBVIEW_DIR/assets/blood-explosion.js"
BACKUP="$HTML.bak"

if [ ! -d "$EXT_DIR" ]; then
  echo "ERROR: pixel-agents extension not found at $EXT_DIR"
  exit 1
fi

if grep -q "blood-explosion" "$HTML" 2>/dev/null; then
  echo "Mod already installed."
  exit 0
fi

# Backup original
cp "$HTML" "$BACKUP"
echo "Backed up index.html → index.html.bak"

# Copy mod script
cp "$MOD_SRC" "$MOD_DEST"
echo "Copied blood-explosion.js → $MOD_DEST"

# Inject script tag BEFORE the main bundle (so we can intercept addEventListener early)
sed -i '' 's|<script type="module" crossorigin src="./assets/index-BUrEakFE.js"></script>|<script src="./assets/blood-explosion.js"></script>\n    <script type="module" crossorigin src="./assets/index-BUrEakFE.js"></script>|' "$HTML"

echo "Patched index.html — blood-explosion mod installed."
echo "Reload the pixel-agents panel in VS Code to activate."
