# Floating Timer Window — Implementation Log

## `hotkey-rewire` — 2026-05-23 14:03:39

**Status:** done
**Summary:** Refactored `HotkeyManager` from a single hard-coded Carbon binding into a multi-binding manager. It now accepts `[HotkeyBinding]`, assigns stable registration IDs, installs one Carbon event handler, and dispatches each hotkey press to the callback for that registration ID. `AppDelegate` now registers only `Option-Command-Return` for the existing start/pause/resume behavior; `Control-Option-Command-P` is no longer registered in this slice so the next slice can use it for the floating panel.
**Deviations:** The `/implement` resource files named in the Ralph prompt (`tdd-loop.md`, `log-format.md`) were not present under the readable local skill directories, so I followed the stated red/green/refactor requirements directly and matched the existing project log style.
**Handoff:** Added `HotkeyManagerTests.testTwoDistinctRegistrationsRouteToTheirOwnCallbacks`, backed by an injected fake `HotkeyBackend`, to prove two distinct key/modifier combinations register successfully and route to their own callbacks. `xcodegen generate` succeeds. `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO` builds the app/test bundle but cannot communicate with `testmanagerd` from this sandbox; running the built bundle directly with `xcrun xctest DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` passes 58 tests, with the 3 pre-existing CLI integration tests skipped.
