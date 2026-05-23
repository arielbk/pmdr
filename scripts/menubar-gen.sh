#!/usr/bin/env bash
# Regenerate apps/menubar/pmdr-menubar.xcodeproj from project.yml.
# Run this after editing apps/menubar/project.yml (e.g. adding a Swift file).
set -euo pipefail

cd "$(dirname "$0")/../apps/menubar"
xcodegen generate
