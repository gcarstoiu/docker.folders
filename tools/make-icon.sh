#!/bin/bash
#
# Render the plugin icon from its SVG source.
#
#   ./tools/make-icon.sh
#
# Community Apps wants a raster icon at a URL; the SVG is the source of
# truth. Uses a local rsvg-convert/magick if present, otherwise headless
# Chrome in Docker so nothing has to be installed.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/src/usr/local/emhttp/plugins/simple.folders/images"
SRC="$DIR/icon.svg"
OUT="$DIR/icon.png"
SIZE="${1:-128}"

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w "$SIZE" -h "$SIZE" "$SRC" -o "$OUT"
elif command -v magick >/dev/null 2>&1; then
  magick -background none "$SRC" -resize "${SIZE}x${SIZE}" "$OUT"
else
  echo "rendering with headless Chrome (no rsvg-convert or magick here)"
  docker run --rm -u "$(id -u):$(id -g)" -v "$DIR:/i" -e HOME=/tmp \
    --entrypoint chromium-browser zenika/alpine-chrome \
    --headless --disable-gpu --no-sandbox --user-data-dir=/tmp/cr \
    --hide-scrollbars --default-background-color=00000000 \
    --window-size="$SIZE,$SIZE" --screenshot=/i/icon.png \
    "file:///i/icon.svg" >/dev/null 2>&1
fi

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
