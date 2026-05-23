#!/usr/bin/env bash
# Build and launch the macOS menubar app (Debug).
#
# Skips xcodegen if pmdr-menubar.xcodeproj already exists — run scripts/menubar-gen.sh
# (or `pnpm menubar:gen`) after editing project.yml.
#
# Kills any running pmdr menubar instance before launching so you don't stack copies.
set -euo pipefail

cd "$(dirname "$0")/../apps/menubar"

if [ ! -e pmdr-menubar.xcodeproj ]; then
  xcodegen generate
fi

xcodebuild -quiet -scheme pmdr-menubar -configuration Debug build

pkill -x pmdr 2>/dev/null || true

built_dir=$(xcodebuild -scheme pmdr-menubar -configuration Debug -showBuildSettings \
  | awk -F' = ' '/ BUILT_PRODUCTS_DIR /{print $2; exit}')

open "$built_dir/pmdr.app"
