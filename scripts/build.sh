#!/bin/sh
# Build a clean unpacked copy in dist/feishu-notify-extension and a zip next to it.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT=dist/feishu-notify-extension
rm -rf dist && mkdir -p "$OUT"
cp manifest.json "$OUT/" && cp -r src "$OUT/"
if command -v zip >/dev/null; then (cd dist && zip -qr "feishu-notify-extension-$VERSION.zip" feishu-notify-extension); else (cd dist && python3 -m zipfile -c "feishu-notify-extension-$VERSION.zip" feishu-notify-extension); fi
echo "unpacked: $(pwd)/$OUT"
echo "zip:      $(pwd)/dist/feishu-notify-extension-$VERSION.zip"
