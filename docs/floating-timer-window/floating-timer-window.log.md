# Floating Timer Window — Implementation Log

## `hotkey-rewire` — 2026-05-23 14:03:39

**Status:** done
**Summary:** Refactored `HotkeyManager` from a single hard-coded Carbon binding into a multi-binding manager. It now accepts `[HotkeyBinding]`, assigns stable registration IDs, installs one Carbon event handler, and dispatches each hotkey press to the callback for that registration ID. `AppDelegate` now registers only `Option-Command-Return` for the existing start/pause/resume behavior; `Control-Option-Command-P` is no longer registered in this slice so the next slice can use it for the floating panel.
**Deviations:** Initial targeted `rg` lookup did not find the `/implement` resource files, so I proceeded from the prompt and existing log style; the broader `find` completed after the slice commit and located the templates under `/Users/arielbk/Projects/sandbox/arielbk-skills/skills/engineering/implement/resources/`. The log entry already matched `log-format.md`; the tests were added as a compact matrix before the implementation rather than one test/implementation pair at a time.
**Handoff:** Added `HotkeyManagerTests.testTwoDistinctRegistrationsRouteToTheirOwnCallbacks`, backed by an injected fake `HotkeyBackend`, to prove two distinct key/modifier combinations register successfully and route to their own callbacks. `xcodegen generate` succeeds. `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO` builds the app/test bundle but cannot communicate with `testmanagerd` from this sandbox; running the built bundle directly with `xcrun xctest DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` passes 58 tests, with the 3 pre-existing CLI integration tests skipped.

## `view-model` — 2026-05-23 14:06:28

**Status:** done
**Summary:** Added `FloatingTimerViewModel` to `PmdrMenubarCore` as a pure mapping from `Status` plus optional last project into panel display fields: `time`, `phaseLabel`, `projectName`, and `isMuted`. Idle renders `--:--`, `idle`, the last project or an empty project, and muted styling; running and paused statuses render active phase/project data with an unmuted state and a frozen `MM:SS` value from the status payload.
**Deviations:** The `/implement` resource files named in the Ralph prompt (`tdd-loop.md`, `log-format.md`) were not present under the readable local skill directories, so I followed the stated red/green/refactor requirements directly and matched the existing project log style.
**Handoff:** Added `FloatingTimerViewModelTests` covering idle with and without last project, running focus, running break, paused focus, and paused break. `xcodegen generate` succeeds. `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO` builds the app/test bundle but cannot communicate with `testmanagerd` from this sandbox; running the built bundle directly with `xcrun xctest DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` passes 64 tests, with the 3 pre-existing CLI integration tests skipped.

## `position-store` — 2026-05-23 14:11:19

**Status:** done
**Summary:** Added `FloatingTimerPosition` to `PmdrMenubarCore` with per-display position lookup, recording, and top-right default placement. Positions are stored in one `UserDefaults` key as a display-ID keyed map derived from each screen's `NSScreenNumber`.
**Deviations:** Used `NSDeviceDescriptionKey("NSScreenNumber")` directly because this SDK does not expose `.screenNumber` as a typed static member. Tests use a lightweight `NSScreen` subclass to supply deterministic display IDs and frames.
**Handoff:** Added `FloatingTimerPositionTests` covering round-trip persistence, multi-display coexistence, unknown display miss, and default top-right anchoring with a 24-point inset. `xcodegen generate` succeeds. `xcodebuild build-for-testing -scheme pmdr-menubar -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO` succeeds. Direct `xcrun xctest DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` passes 68 tests, with the 3 pre-existing CLI integration tests skipped.
