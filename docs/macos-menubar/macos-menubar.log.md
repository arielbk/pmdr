# macOS Menubar — Ralph Log

## 2026-05-17 — `app-skeleton` (needs-review)

**Goal:** Launching the `.app` puts a `pmdr` label in the macOS menubar with a one-item Quit menu.

**State on entry**
- Tasks file existed with `app-skeleton` already at `Status: in-progress`, but no log file and no commits. A prior Ralph iteration had partially scaffolded the app under `apps/menubar/` (untracked) and bailed:
  - `project.yml` (XcodeGen spec, target `pmdr-menubar`, product name `pmdr`, deployment macOS 13).
  - `Resources/Info.plist` with `LSUIElement = true`, principal class `NSApplication`.
  - `Sources/main.swift` — installs `AppDelegate`, sets `.accessory` activation policy.
  - `Sources/AppDelegate.swift` — creates an `NSStatusItem` with title `pmdr` and a `Quit` menu item bound to `NSApplication.terminate(_:)` (key `q`).

**What I did**
- Adopted the prior iteration's XcodeGen layout as-is — it matches the PRD better than my initial SwiftPM attempt (real `.app` bundle, `LSUIElement` for proper menubar-only behavior, `xcodebuild`-able). Removed my redundant `Package.swift` and `Sources/PmdrMenubar/` duplicates.
- Added `apps/menubar/.gitignore` covering `.build/`, `.swiftpm/`, `*.xcodeproj/`, `DerivedData/`, `Package.resolved` — the `.xcodeproj` is a generated artifact of XcodeGen and shouldn't be checked in.
- Wrote `apps/menubar/README.md` with the build flow: `brew install xcodegen` → `xcodegen generate` → open in Xcode / `xcodebuild`.

**Why XcodeGen over a hand-written `.xcodeproj`**
- A `pbxproj` is brittle and ugly to write by hand. XcodeGen turns the same intent into a 30-line `project.yml`, plays well with code review, and regenerates the project deterministically. It is the convention most Swift open-source projects use for exactly this reason.
- The `.xcodeproj` itself is regenerable, so it stays out of git — single source of truth lives in `project.yml`.

**Feedback loop not executed**
- This Ralph iteration runs in a Linux sandbox with no Swift / Xcode / XcodeGen toolchain. The slice's feedback loop is "Manual — `xcodebuild` or run from Xcode, confirm the status item appears in the menubar and Quit terminates the app." A human needs to run it on macOS.
- Marked `Status: needs-review` instead of `done` to surface this — neither a previous agent nor I have actually verified the binary launches.

**To verify on macOS**
1. `brew install xcodegen` (if not present).
2. `cd apps/menubar && xcodegen generate`.
3. `open pmdr-menubar.xcodeproj` → Run, or `xcodebuild -scheme pmdr-menubar` then launch `pmdr.app` from `BUILT_PRODUCTS_DIR`.
4. Expect: a `pmdr` label appears in the menubar, no Dock icon, no main window. Clicking the label shows a single `Quit` item; choosing it terminates the process.

**Open follow-ups (not this slice)**
- Replace the `pmdr` text title with an `SF Symbol` icon once we have a state model (`live-title`, `menu-actions`).
- Code signing / notarization / `.app` distribution — out of scope per PRD.

## 2026-05-17 — `pmdr-client` (needs-review)

**Goal:** `PmdrClient.status() async throws -> Status` mirroring `StatusResult` in `apps/cli/src/commands/status.ts`. Typed `.binaryNotFound` error when `pmdr` is missing from PATH. Integration tests against the real CLI in a temp `HOME`.

**State on entry**
- Tasks file had `pmdr-client` flipped to `Status: in-progress` (uncommitted) by an earlier Ralph iteration that bailed.
- That iteration had already produced two untracked files but never wired them up or committed:
  - `apps/menubar/Sources/PmdrClient.swift` — `Status` / `Phase` / `PmdrClientError` types, `decodeStatus(from:)` JSON parser, `resolveBinary(hint:environment:)` PATH search, async `run(arguments:)` over `Process`, and the public `status()` entry point.
  - `apps/menubar/Tests/PmdrMenubarTests/PmdrClientTests.swift` — three test classes: pure decoding (`PmdrClientDecodingTests`), binary resolution under a controlled PATH (`PmdrClientBinaryResolutionTests`), and integration (`PmdrClientIntegrationTests`) skipped unless `PMDR_INTEGRATION=1`.
- `project.yml` had only the app target; no test target, so `xcodebuild test` would have been a no-op.

**What I did**
- Reviewed the inherited `PmdrClient.swift` against `apps/cli/src/commands/status.ts`. The `StatusResult` shape (`state`, `remainingMs`, `duration`, `startedAt`, `phase`, `completedFocusBlocks`) and the `idle | running | paused` variants are faithfully mirrored. The `Status.Active.durationMs` field maps from the CLI's `duration` (which is also milliseconds — see `apps/cli/src/state.ts`) and is renamed for Swift clarity.
- Reviewed the inherited test file. Decoding tests cover idle, running-focus, paused-break, unknown state, missing fields, and invalid JSON. Binary-resolution tests cover absent-on-PATH, present-on-PATH, and absolute-path-when-executable, plus an end-to-end `status()` call that asserts `.binaryNotFound` propagates. Integration tests exercise idle / running / paused against a real `pmdr` under a temp `HOME`. This matches the slice's feedback loop.
- Wired `pmdr-menubarTests` into `project.yml`:
  - `type: bundle.unit-test`, sources rooted at `Tests/PmdrMenubarTests`, dependency on `pmdr-menubar`, with `BUNDLE_LOADER` / `TEST_HOST` pointing at the app's binary so `@testable import pmdr` works.
  - Added a `pmdr-menubar` scheme entry so `xcodebuild test -scheme pmdr-menubar` resolves the test target. (XcodeGen auto-creates an app-only scheme by default; the explicit `schemes:` block keeps the test target attached.)
- Updated the README's layout diagram to include `PmdrClient.swift` and a `Tests/PmdrMenubarTests/` entry, and added a Tests section with the `xcodebuild test` invocation and the `PMDR_INTEGRATION=1` gate.

**Why a thin Process shell, not URLSession or a daemon**
- The CLI is the only source of truth for state mutations; the menubar PRD explicitly calls for shelling out rather than reimplementing the state machine.
- A short-lived `Process` per poll is cheap on macOS and avoids any IPC plumbing. We poll on the order of 1Hz when the menu is open and slower otherwise — well within budget.

**Why `@testable import pmdr` instead of making everything public**
- `PmdrClient`, `Status`, etc. are declared `public` in the source so the integration tests (which currently happen to live in the same module) read the same surface a future consumer would. `@testable` was kept in the tests so internal helpers (`decodeStatus`, `resolveBinary`) remain reachable without widening their access for non-test callers. The two are not in conflict — `@testable` opens internals, `public` exposes the API.

**Feedback loop not executed**
- This iteration runs in a Linux sandbox with no Swift / Xcode / XcodeGen toolchain available. The slice's pure unit tests, binary-resolution tests, and `PMDR_INTEGRATION=1` integration tests all require macOS. A human (or a macOS Ralph runner) needs to run them.
- Marked `Status: needs-review` instead of `done` to flag this — the implementation has not been compile-checked, let alone exercised.

**To verify on macOS**
1. `cd apps/menubar && xcodegen generate`
2. `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'` — expect all decoding and resolution tests green; integration tests skipped.
3. `pnpm --filter cli build` then expose the resulting bin on PATH (symlink to `pmdr` or `pnpm link --global`).
4. `PMDR_INTEGRATION=1 xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'` — expect idle, running, paused all green against a temp-`HOME` `pmdr`.

**Open follow-ups (not this slice)**
- No callers yet — `PmdrClient` is wired into the project but the `AppDelegate` still shows the static `pmdr` title. The `live-title` slice plugs the poller into it.
- The integration tests rely on `HOME` overriding `STATE_DIR`. `apps/cli/src/commands/status.ts` builds `STATE_DIR` from `homedir()` at module load, so a per-process `HOME` swap is sufficient — but worth re-verifying once the CLI grows env-var overrides.
