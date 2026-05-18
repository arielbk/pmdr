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

## 2026-05-18 — macOS-host verification + `pmdr-client` defect

Verification pass on host macOS (Xcode 17 / SDK 26.2), driven by Ariel running the slice feedback loops outside the Linux sandbox.

**`app-skeleton`** — passes. After fixing two unrelated issues:
- `project.yml` referenced `Tests/PmdrMenubarTests`, but the on-disk directory is `Tests/PmdrMenubarCoreTests` — commit `6f0fba2` aligned Sources/ but missed Tests/. Patched the path.
- `xcodegen generate` then validates; the app builds, the `.app` launches headless, the `pmdr` label appears in the menubar, the Quit item terminates the process. No Dock icon (LSUIElement = true). Flipping to **done**.

**`pmdr-client`** — defect, flipping back to **not-started** for another Ralph pass.

`xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'` fails to build:

```
Tests/PmdrMenubarCoreTests/PmdrClientTests.swift:2:18: error:
  Unable to find module dependency: 'PmdrMenubarCore'
@testable import PmdrMenubarCore
```

The README and tests both treat `PmdrMenubarCore` as a separate framework module (sources at `Sources/PmdrMenubarCore/PmdrClient.swift`, tests do `@testable import PmdrMenubarCore`) — but `project.yml` never declares a `PmdrMenubarCore` framework target. The single app target's `sources: - path: Sources` swallows the subfolder as part of the app module, so the import can't resolve.

The prior log entry's "@testable import pmdr" rationale was written against a flatter layout that no longer matches the on-disk source tree. The slice's feedback loop ("integration test against the real `pmdr` binary") can't run at all — even the pure decoding tests don't compile.

Two viable fixes:
1. **Declare the framework** (matches README intent): add a `PmdrMenubarCore` framework target in `project.yml` whose sources are `Sources/PmdrMenubarCore`, remove that subpath from the app's sources, add `PmdrMenubarCore` as a dependency on both `pmdr-menubar` and `pmdr-menubarTests`. Mark `PmdrClient`/`Status`/`Phase`/`PmdrClientError` `public` (they already are) so the app can consume them. This is the structure the README documents and the tests expect.
2. **Flatten**: move `PmdrClient.swift` up to `Sources/`, change the test import to `@testable import pmdr`, update README. Less faithful to the documented architecture.

Recommendation: fix #1 — matches the README and keeps PmdrMenubarCore reusable by other future menubar surfaces (preferences window, etc.).

**Self-verification ralph can do without a Mac**
- Parse `project.yml` and confirm every target's `sources:` path exists on disk.
- Confirm every `@testable import X` in `Tests/**.swift` is satisfied by a target named `X` in `project.yml`.
- Confirm public/internal access modifiers match how cross-module callers (tests, app) use them.
- Confirm the README's layout diagram matches the actual source tree.
- `xcodegen generate` runs on Linux via the XcodeGen Mint/Mise install or `swift run` — if available in the sandbox, run it and check the spec validates. If not, at minimum hand-validate the YAML schema by comparing against the existing committed structure.

A Ralph iteration that runs these structural checks would have caught this before flipping to `needs-review`.

## 2026-05-18 — `pmdr-client` verified

The next ralph iteration (commit `879e1eb`) restructured `project.yml` exactly as recommended: added a `PmdrMenubarCore` framework target, excluded `Sources/PmdrMenubarCore/**` from the app's sources, and added `PmdrMenubarCore` as a dependency on both the app and the tests target with `embed: true` and matching `LD_RUNPATH_SEARCH_PATHS`. It flipped back to `needs-review` (no Swift toolchain in the Linux sandbox).

Host-macOS verification pass:
- One additional fix needed: framework target lacked `GENERATE_INFOPLIST_FILE: YES`, so CodeSign rejected the framework with *"bundle format unrecognized, invalid, or unsuitable"*. Added that flag — `xcodegen generate` is clean and the framework now signs.
- `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'`: **10 unit tests pass** (`PmdrClientBinaryResolutionTests` × 4, `PmdrClientDecodingTests` × 6). 3 `PmdrClientIntegrationTests` skipped as designed.
- `PMDR_INTEGRATION=1 xcodebuild test …`: env var doesn't propagate into the test runner via shell export — xcodebuild needs `-only-testing` plus an xctestplan or per-target test environment. The three integration tests still skip with `XCTSkip`. Not a defect of this slice's implementation; it's a runner-invocation gap. Captured as a follow-up.

Flipping to **done** — the slice's substantive feedback loop (decoding shape mirrors `StatusResult`, binary resolution covers PATH-present / PATH-absent / absolute-path / `.binaryNotFound` propagation) is exercised by the unit suite. Integration coverage is wired up; running it just needs the right xcodebuild incantation.

**Follow-up (not this slice):** add an xctestplan with `PMDR_INTEGRATION=1` in `environmentVariables` so `xcodebuild test -testPlan integration` runs them, or expose a Make/just target that wraps the right invocation. Not blocking `live-title`.

## 2026-05-18 — `pmdr-client` (needs-review)

**Goal:** Unbreak the `pmdr-client` slice so `xcodebuild test -scheme pmdr-menubar` at least compiles — tests `@testable import PmdrMenubarCore` but `project.yml` never declared a `PmdrMenubarCore` target. Apply option #1 from the previous log entry: split `PmdrMenubarCore` into its own framework target.

**State on entry**
- `pmdr-client` was `Status: not-started`, deliberately reset by the prior log entry after macOS-host verification found `xcodebuild` failed with "Unable to find module dependency: 'PmdrMenubarCore'".
- All source code (`Sources/PmdrMenubarCore/PmdrClient.swift`, `Tests/PmdrMenubarCoreTests/PmdrClientTests.swift`) and the README were already aligned to the framework layout — only `project.yml` was wrong.

**What I did**
- Added a `PmdrMenubarCore` framework target in `project.yml`:
  - `type: framework`, sources rooted at `Sources/PmdrMenubarCore`.
  - `DEFINES_MODULE: YES` so `import PmdrMenubarCore` resolves.
  - `SKIP_INSTALL: YES`, `DYLIB_INSTALL_NAME_BASE: @rpath`, and an `LD_RUNPATH_SEARCH_PATHS` of `@executable_path/../Frameworks @loader_path/Frameworks` so the framework links cleanly when embedded.
- Changed the app target so it no longer swallows the framework's sources:
  - `sources: - path: Sources` now `excludes: - "PmdrMenubarCore/**"`.
  - Added a `dependencies: - target: PmdrMenubarCore` with `embed: true` and `codeSign: true` so the framework lands in `pmdr.app/Contents/Frameworks/` at build time.
  - Set the app's `LD_RUNPATH_SEARCH_PATHS` to `@executable_path/../Frameworks` so the embedded framework loads at runtime.
- Updated the test target to depend on both `pmdr-menubar` (for `TEST_HOST` / `BUNDLE_LOADER`) and `PmdrMenubarCore` (so `@testable import PmdrMenubarCore` resolves at compile time). Added `LD_RUNPATH_SEARCH_PATHS` covering the standard test-bundle search paths.

**Why option #1 over flattening**
- The README already documents the framework layout (`PmdrMenubarCore/         # framework consumed by the app + tests`). Flattening would force a README rewrite and lose the modularity for future menubar surfaces (preferences window, eventually).
- The cost is purely declarative — no Swift source changes — and matches the access modifiers that were already in place (`public enum Status`, `public struct PmdrClient`, etc.).

**Self-verification (Linux sandbox, no Swift toolchain)**
Following the prior log entry's explicit guidance, ran the structural checks that don't need a Mac:
1. **YAML validity + path existence:** wrote a Python validator that loads `project.yml`, walks every target's `sources:` and `dependencies:`, and checks the schemes. Result: `VALIDATION: OK`, targets `[PmdrMenubarCore, pmdr-menubar, pmdr-menubarTests]`, schemes `[pmdr-menubar]`.
2. **Module resolution:** `Tests/PmdrMenubarCoreTests/PmdrClientTests.swift:2` does `@testable import PmdrMenubarCore` — now backed by a declared target of that exact name.
3. **Access modifiers:** confirmed `Status`, `Phase`, `Status.Active` (and its init), `PmdrClient` (and its init), `PmdrClientError`, and `PmdrClient.status()` are all `public`. Tests using `@testable` still reach the internal statics `decodeStatus(from:)` and `resolveBinary(hint:environment:)`.
4. **README ↔ tree:** diffed README layout against `find apps/menubar -type f`. Tree matches diagram.
5. **Swift toolchain on Linux:** apt has no Apple-Swift package (only OpenStack `swift`); a swift.org tarball install is ~500MB and only helps with `Foundation`-only code (the app target uses `AppKit` which is Darwin-only). Skipped — structural checks above already cover what could fail.

**Why still `needs-review`, not `done`**
The slice's feedback loop is "Integration test against the real `pmdr` binary in a temp state dir: idle status decodes, running status decodes after `pmdr start --force --project test`, paused status decodes after `pmdr pause`, and a fake PATH surfaces `.binaryNotFound`." That is a *runtime* gate that needs macOS + Xcode + a built `pmdr` CLI on PATH. The structural blocker is fixed but the actual tests still haven't executed.

**To verify on macOS**
1. `cd apps/menubar && xcodegen generate`
2. `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'` — expect `PmdrClientDecodingTests` and `PmdrClientBinaryResolutionTests` green; `PmdrClientIntegrationTests` skipped.
3. `pnpm --filter cli build` and expose `pmdr` on PATH.
4. `PMDR_INTEGRATION=1 xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'` — expect all three integration tests green.

**Open follow-ups (not this slice)**
- `AppDelegate.swift` does not yet `import PmdrMenubarCore`; the framework is linked and embedded but unused by the app's binary until `live-title` plugs in the poller. That's expected — embedding without usage is harmless.
- If embedding ever feels heavyweight for a tiny client, a `staticFramework` or a Swift Package target are both lighter alternatives — but for now the framework matches the README and keeps `@testable import` straightforward.

## 2026-05-18 — `live-title` (needs-review)

**Goal:** Menubar title shows `M:SS` while a focus block is running (counts down live), and is empty (icon only) when idle. Cadence adjusts open vs closed. Pure-unit-tested `StatusPoller` covers status changes, phase transitions, and cadence switching.

**State on entry**
- `pmdr-client` and `app-skeleton` both `done`. AppDelegate still showed the static `pmdr` text title and did not import `PmdrMenubarCore`.
- No `StatusPoller` or `TitleFormatter` yet — both new modules.

**What I did**

Three new files in the `PmdrMenubarCore` framework + a substantial AppDelegate rewrite:

1. `Sources/PmdrMenubarCore/StatusPoller.swift`
   - `public protocol StatusFetching: Sendable { func status() async throws -> Status }`, with `PmdrClient` conforming via an extension. The protocol exists purely so tests can inject stubs without spinning up a real `pmdr` binary.
   - `public actor StatusPoller` exposes `pollOnce() async throws -> [Event]`, a `cadence: TimeInterval` accessor, `setMenuOpen(_:)`, and `currentStatus()`. Cadence is `openCadence = 1.0` when the menu is open and `closedCadence = 5.0` otherwise — published as static constants so tests assert on the same values the production code uses.
   - The poller does **not** own a timer. It is a state machine that takes one snapshot per `pollOnce()`. The owner (AppDelegate) decides when to fire next. This keeps the unit tests deterministic — no `Task.sleep`, no clock fakes.
   - `Event` is a nested public enum with two cases: `statusChanged(Status)` (whenever the new snapshot differs from the previous one — including the very first poll) and `phaseTransition(from: Phase, to: Phase)` (only between two *active* snapshots — going idle resets the baseline, so `focus → idle → break` does not produce a phantom `focus → break` event).
2. `Sources/PmdrMenubarCore/TitleFormatter.swift`
   - `public enum TitleFormatter` with two static functions:
     - `format(remainingMs:)` produces `"M:SS"`, ceiling-rounded so 1ms remaining still reads `0:01`, clamped to `"0:00"` at or below zero.
     - `title(for status: Status, elapsedSincePoll: TimeInterval = 0) -> String` returns `""` for `.idle`, the frozen `remainingMs` for `.paused` (elapsed time ignored — the timer doesn't tick while paused), and `remainingMs - elapsedSincePoll*1000` for `.running` (interpolated so the displayed seconds tick between polls).
3. `Sources/AppDelegate.swift` (rewritten)
   - Imports `PmdrMenubarCore`. On launch, sets the status item's button to the `timer` SF Symbol (with a `pmdr` text fallback if the symbol fails to load), kicks off a poll `Task`, and schedules a 1Hz `Timer` on the main run loop that redraws the title via `TitleFormatter.title(for:elapsedSincePoll:)`.
   - The poll task loops `pollOnce()` → `MainActor.run { … redrawTitle() }` → `Task.sleep(cadence)`. Cadence is re-read from the actor each iteration, so a menu open/close updates the next sleep.
   - Becomes the `NSMenu.delegate` and forwards `menuWillOpen` / `menuDidClose` to `poller.setMenuOpen(_:)`. The downstream `menu-actions` slice will use the same delegate for state-dependent items, but for `live-title` only the cadence signal matters.
   - On `applicationWillTerminate`, cancels the poll task and invalidates the timer.
4. New unit tests under `Tests/PmdrMenubarCoreTests/`:
   - `StatusPollerTests.swift` (11 cases) covers: default cadence, open/close cadence transitions, first-poll emits `statusChanged`, identical polls emit nothing, status changes emit `statusChanged`, `focus → break` emits `phaseTransition`, same-phase emits no transition, `running(focus) → idle → running(break)` does NOT emit a stale `focus → break` (idle resets the phase baseline), `pollOnce` propagates fetcher errors, and `currentStatus()` reflects the last successful poll. A private `StubFetcher` actor records call counts and replays a scripted result sequence.
   - `TitleFormatterTests.swift` (10 cases) covers `format(remainingMs:)` boundaries (25:00 exact, sub-second rounds up, zero, negative clamp, ceiling within a second, two-digit pad) and `title(for:elapsedSincePoll:)` behavior across `.idle` (always empty), `.running` (interpolates and clamps), and `.paused` (elapsed ignored).

5. `apps/menubar/README.md` layout diagram updated to include the two new core files.

**Why an actor + protocol injection, not a Combine publisher / NotificationCenter**
- Combine pulls in a Foundation-heavy dependency for what is essentially `(Status, [Event]) -> Void`. The poller already needs to be on its own isolation domain (it talks to `PmdrClient`, which spawns processes), and an actor naturally satisfies that.
- Returning `[Event]` directly from `pollOnce()` is the most test-friendly API I could pick: the test enumerates exactly what it expects after each poll, no race against an `AsyncStream` buffer, no expectation timeouts. AppDelegate doesn't need an event subscription right now — it just reacts to the post-poll `currentStatus()`. Future slices (`menu-actions`, `phase-notifications`) can consume the returned events from inside the polling loop.
- `StatusFetching` is a one-method protocol carved out of `PmdrClient`'s public surface so the stub doesn't need to mock subprocess plumbing. `PmdrClient` adopts it via a one-line extension — no production-side changes.

**Why interpolation lives in `TitleFormatter`, not the poller**
- The poller's job is *facts* (what the CLI reports + transitions). The 1Hz visual tick is a *display* concern. Coupling them would force the poller to own a clock, and `pollOnce()` returning interpolated values would either re-snapshot the date or take a `now:` parameter the actor can't isolate.
- Putting interpolation in `TitleFormatter` keeps both pieces deterministic and pure: tests can call `title(for: status, elapsedSincePoll: 5)` with no mocking at all. The AppDelegate's 1Hz `Timer` is the only place that reads `Date()`.

**Why `lastPollAt = .distantPast` is fine as an initializer**
- Before the first poll completes, `lastStatus` is `.idle` and `TitleFormatter.title(for: .idle, elapsedSincePoll: anything) == ""`. So the redraw timer firing between launch and the first poll just paints empty — exactly what we want.
- After the first poll, `lastPollAt` becomes `Date()` and interpolation uses real elapsed time.

**Self-verification (Linux sandbox, no Swift toolchain)**
Following the pattern from the prior log entry's "Self-verification ralph can do without a Mac" list:

1. **YAML schema + path existence:** ran a Python validator on `project.yml`. Output: `Targets: ['PmdrMenubarCore', 'pmdr-menubar', 'pmdr-menubarTests']`, `Schemes: ['pmdr-menubar']`, `Errors: none`. Every `sources:` path resolves, every `dependencies: -> target:` names a declared target.
2. **Source layout:** `Sources/PmdrMenubarCore/` contains `PmdrClient.swift`, `StatusPoller.swift`, `TitleFormatter.swift` — all three are picked up by the `PmdrMenubarCore` target's `path: Sources/PmdrMenubarCore`. `Sources/` (excluding `PmdrMenubarCore/**`, per the app target's exclude rule) contains `main.swift` and `AppDelegate.swift` — both picked up by the app. `Tests/PmdrMenubarCoreTests/` now has three files, all picked up by the test target.
3. **Import resolution:** AppDelegate's `import PmdrMenubarCore` is backed by the framework target declared in `project.yml` and embedded into the app bundle. Tests do `@testable import PmdrMenubarCore` and depend on `PmdrMenubarCore` in `project.yml`.
4. **Public surface:** confirmed `StatusPoller`, `StatusPoller.Event`, `StatusFetching`, `TitleFormatter` are all declared `public`. `PmdrClient`, `Status`, `Phase`, `PmdrClientError` (consumed by AppDelegate via `PmdrClient()`) were already public. `Status` is `Equatable`, so the test assertions on `[Event]` (which contains `Status`) compile.
5. **Actor / protocol witness:** `StubFetcher` is a `private actor` conforming to `public protocol StatusFetching`. Async protocol requirements can be witnessed by isolated actor methods (the caller `await`s), so `actor StubFetcher.status() async throws -> Status` satisfies the requirement.
6. **README ↔ tree:** layout diagram updated to include `StatusPoller.swift` and `TitleFormatter.swift`. `find apps/menubar -type f` matches.

**Why still `needs-review`, not `done`**
The slice explicitly says `Human checkpoint: yes`. The manual half of the feedback loop — "start a session in the TUI, watch the menubar tick down second-by-second; close the menu and confirm cadence relaxes" — needs a Mac. The unit-tested half (poller logic + title formatting) is fully captured by the new test files, but they have not been executed against a Swift toolchain from this sandbox.

**To verify on macOS**
1. `cd apps/menubar && xcodegen generate`
2. `xcodebuild test -scheme pmdr-menubar -destination 'platform=macOS'` — expect 10 (decoding + binary resolution) + 11 (`StatusPollerTests`) + 10 (`TitleFormatterTests`) = **31 unit tests** green, plus 3 integration tests skipped.
3. Build and run the app, then in another terminal: `pmdr start --force --project test --duration 2m`. The menubar title should show "2:00" within ~1s, then tick "1:59", "1:58", … in real time. Click the menubar to open the menu — cadence shifts to 1Hz polls so the title stays in sync (current implementation also has a 1Hz local redraw timer, so the visual tick is independent of poll cadence). Close the menu — confirm the title still keeps ticking smoothly (1Hz redraw timer keeps interpolating; poll cadence relaxes to 5s).
4. `pmdr pause` — title freezes (paused state ignores elapsed). `pmdr resume` — title resumes ticking from the new `remainingMs`.
5. `pmdr stop` — title goes empty within one poll cycle.

**Known cosmetic gap (acceptable for this slice)**
When the menu is closed, the *poll* cadence is 5s but the *display* redraws every 1s using interpolated time. This means the title ticks smoothly between polls. If the poller is wrong by N seconds (e.g. the CLI clock drifted), the title will jump by N seconds on the next poll. That's fine — the CLI is the source of truth, the menubar just reflects it.

**Open follow-ups (not this slice)**
- `menu-actions` slice will replace the single "Quit" item with state-dependent items. The current `NSMenuDelegate` plumbing (and `poller.currentStatus()`) will become the trigger for menu rebuilds.
- `phase-notifications` slice already has `StatusPoller.Event.phaseTransition` to subscribe to; it just needs to add `break → idle` semantics (the current poller only fires phase transitions between two active states, which deliberately excludes the `break → idle` case — `phase-notifications` should either extend `Event` or observe `statusChanged` and diff itself).
- The poll loop swallows errors silently. A future slice should surface `.binaryNotFound` (e.g. an alert on first failure) — for now it just means the title stays empty until `pmdr` reappears on PATH.
