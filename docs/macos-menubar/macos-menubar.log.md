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
