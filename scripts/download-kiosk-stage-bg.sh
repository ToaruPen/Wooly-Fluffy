#!/usr/bin/env bash
set -euo pipefail

# Downloads a CC0 stage background and places it in web/public.
#
# Source pack: Kenney "Background Elements" (CC0)
# https://kenney.nl/assets/background-elements
# Direct zip:
# https://kenney.nl/media/pages/assets/background-elements/68a31f3013-1677670395/kenney_background-elements.zip

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/web/public/assets/stage-bg"
OUT_FILE="$OUT_DIR/kenney-uncolored-hills.png"

ZIP_URL="https://kenney.nl/media/pages/assets/background-elements/68a31f3013-1677670395/kenney_background-elements.zip"
ZIP_ENTRY="Samples/uncolored_hills.png"

command -v curl >/dev/null 2>&1 || { echo "curl is required"; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip is required"; exit 1; }

mkdir -p "$OUT_DIR"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "Downloading: $ZIP_URL"
curl -L "$ZIP_URL" -o "$tmpdir/kenney_background-elements.zip"

echo "Extracting: $ZIP_ENTRY"
unzip -j "$tmpdir/kenney_background-elements.zip" "$ZIP_ENTRY" -d "$tmpdir" >/dev/null

cp "$tmpdir/uncolored_hills.png" "$OUT_FILE"

echo "Wrote: $OUT_FILE"
echo "Attribution: $ROOT_DIR/web/public/assets/stage-bg/ATTRIBUTION.md"
