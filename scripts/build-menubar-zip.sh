#!/usr/bin/env bash
# Build the macOS menubar app (Release, universal) and package it as the zip that
# ships inside the @arielbk/pmdr npm package.
#
# Produces, in the output directory (default apps/cli/bundled-app):
#   pmdr-app.zip   — ditto archive of pmdr.app, symlinks and ad-hoc signature intact
#   pmdr-app.json  — { "version": "<CFBundleShortVersionString>" } for the CLI locator
#
# Usage: scripts/build-menubar-zip.sh [output-dir]
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="${1:-$repo_root/apps/cli/bundled-app}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-menubar-zip: macOS only (needs xcodebuild)" >&2
  exit 1
fi

cd "$repo_root/apps/menubar"
xcodegen generate

# No -destination: Release already builds universal (x86_64 + arm64).
xcodebuild -quiet -scheme pmdr-menubar -configuration Release build

built_dir=$(xcodebuild -scheme pmdr-menubar -configuration Release -showBuildSettings \
  | awk -F' = ' '/ BUILT_PRODUCTS_DIR /{print $2; exit}')
app="$built_dir/pmdr.app"

if [ ! -d "$app" ]; then
  echo "build-menubar-zip: no app at $app" >&2
  exit 1
fi

version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$app/Contents/Info.plist")

mkdir -p "$out_dir"
rm -f "$out_dir/pmdr-app.zip"
ditto -c -k --keepParent "$app" "$out_dir/pmdr-app.zip"
printf '{\n  "version": "%s"\n}\n' "$version" > "$out_dir/pmdr-app.json"

echo "build-menubar-zip: wrote $out_dir/pmdr-app.zip (app version $version)"
