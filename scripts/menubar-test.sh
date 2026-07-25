#!/usr/bin/env bash
# Build and run the menubar unit tests.
#
# `xcodebuild test` needs to talk to testmanagerd, which is unavailable in
# sandboxed/headless environments (agents, CI containers). This script builds
# the test bundle with xcodebuild and then drives it directly through `xctest`,
# which needs no test runner service.
#
# Usage: ./scripts/menubar-test.sh [test-identifier]
#   test-identifier defaults to "All"; pass e.g. OverlaySurfaceTests to narrow.
set -euo pipefail

cd "$(dirname "$0")/../apps/menubar"

TEST_ID="${1:-All}"
DERIVED="$PWD/.derivedData"
PRODUCTS="$DERIVED/Build/Products/Debug"

BUILD_LOG="$DERIVED/build-for-testing.log"
mkdir -p "$DERIVED"
if ! xcodebuild \
  -scheme pmdr-menubar \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED" \
  build-for-testing \
  >"$BUILD_LOG" 2>&1; then
  grep -E 'error:|warning:|BUILD FAILED' "$BUILD_LOG" || tail -40 "$BUILD_LOG"
  echo "full log: $BUILD_LOG" >&2
  exit 1
fi

XCTestBundlePath="$PRODUCTS/pmdr-menubarTests.xctest" \
XCInjectBundleInto="$PRODUCTS/pmdr.app/Contents/MacOS/pmdr" \
  xcrun xctest -XCTest "$TEST_ID" "$PRODUCTS/pmdr-menubarTests.xctest"
