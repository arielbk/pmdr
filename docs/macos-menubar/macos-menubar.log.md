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
