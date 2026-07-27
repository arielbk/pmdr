#!/usr/bin/env bash
# Assert that a pmdr-app.zip is releasable: it extracts to a pmdr.app whose
# signature verifies and whose Mach-O binaries are universal (x86_64 + arm64).
#
# This is the same check the bundled-app slice ran by hand, made repeatable so
# CI and a local `pnpm menubar:zip` are held to one standard.
#
# Usage: scripts/verify-menubar-zip.sh [zip] [version-sidecar]
#   defaults: apps/cli/bundled-app/pmdr-app.zip and .../pmdr-app.json
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
zip="${1:-$repo_root/apps/cli/bundled-app/pmdr-app.zip}"
sidecar="${2:-$(dirname "$zip")/pmdr-app.json}"

fail() {
  echo "verify-menubar-zip: $1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "macOS only (needs ditto, codesign, lipo)"
[ -f "$zip" ] || fail "no zip at $zip"
[ -f "$sidecar" ] || fail "no version sidecar at $sidecar"

version=$(/usr/bin/sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sidecar")
[ -n "$version" ] || fail "$sidecar has no version"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ditto -x -k "$zip" "$work" || fail "could not extract $zip"
app="$work/pmdr.app"
[ -d "$app" ] || fail "$zip does not contain pmdr.app at its root"

plist_version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$app/Contents/Info.plist")
[ "$plist_version" = "$version" ] ||
  fail "sidecar says $version but the app says $plist_version"

codesign --verify --deep --strict "$app" ||
  fail "codesign --verify --deep --strict failed on the extracted app"

# The icon is compiled from the asset catalog, so it goes missing silently — the
# build still succeeds and the app just wears the generic blank-page icon
# everywhere it is seen: Finder, Login Items, notification banners.
[ -f "$app/Contents/Resources/AppIcon.icns" ] ||
  fail "the app has no compiled AppIcon.icns"

# Every Mach-O in the bundle must carry both architectures, not just the main
# binary — a thin embedded framework would break the app on the other arch.
while IFS= read -r binary; do
  archs=$(lipo -info "$binary" 2>/dev/null) || continue
  case "$archs" in
    *x86_64*) ;;
    *) fail "$binary is not x86_64: $archs" ;;
  esac
  case "$archs" in
    *arm64*) ;;
    *) fail "$binary is not arm64: $archs" ;;
  esac
  echo "verify-menubar-zip: universal — ${binary#"$app/"}"
done < <(find "$app" -type f -perm -u+x)

echo "verify-menubar-zip: $zip is releasable (app version $version)"
