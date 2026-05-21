# Project archive UI — log

## 2026-05-21 — `tui-archive-key`

**Status:** done

**What changed:**
- Added optional `onArchive?: (name: string) => void` prop to `ProjectPickerOverlay`. When the highlighted entry is a project (not `None`, not `New`) and the user presses `a`, the overlay invokes `onArchive(name)`. Pressing `a` while on the `New` entry continues to type `a` into the new-name buffer (no regression).
- Added optional `archiveProjectFn` prop to `App` (default: `archiveProject` from `projects.ts`). On overlay archive, `App` calls the function and refreshes `pickerProjects` via `getProjects()`, so the archived row disappears on the next render.
- Added 4 new unit tests in `project-picker-overlay.test.tsx`: archive call with right name, no-op on None, no-op on New (typing instead), and the row-disappears flow under `App`.

**Files touched:**
- `apps/cli/src/tui/ProjectPickerOverlay.tsx`
- `apps/cli/src/tui/App.tsx`
- `apps/cli/src/__tests__/project-picker-overlay.test.tsx`

**Feedback loop result:** `pnpm vitest run` → 23 files, 275 tests passing (including the 4 new ones). `tsc --noEmit` clean. `pnpm -r lint` fails for `apps/cli` due to a pre-existing missing `eslint.config.js` — not caused by this slice.

**Notes for downstream slices:**
- `tui-show-archived` can now layer on: it should add an `A` (shift+a) toggle for `showArchived` and have the parent re-fetch via `listProjects({ includeArchived: true })`. The same `onArchive` callback should also handle the unarchive case when the highlighted row is archived — consider renaming to `onToggleArchive` or adding a sibling `onUnarchive` prop. Archived rows should render dimmed (per slice description); the overlay already has dim styling logic for special entries to mirror.
- The App test for the disappearing-row flow had to pass `readStateFn={() => null}` because the default `App` reads the user's real `~/.local/state/pmdr` state file, which polluted the rendered countdown view with whatever project happened to be live. Future App-integration tests should follow the same pattern.

## 2026-05-21 — `tui-show-archived`

**Status:** done

**What changed:**
- `ProjectPickerOverlay` gained two optional props: `onUnarchive?: (name: string) => void` and `onToggleShowArchived?: () => void`. Pressing `a` on a highlighted **archived** project row now calls `onUnarchive` (instead of `onArchive`); pressing `A` (shift+a) calls `onToggleShowArchived`. Archived project rows render dimmed (via `dimColor`) **and** carry a literal " (archived)" suffix so the marker is visible in monochrome terminals.
- `App` now owns a `pickerShowArchived` boolean. Opening the picker (`p` or after `x`) resets it to `false`; toggling refreshes `pickerProjects` via `getProjects({ includeArchived: next })`. Archive and unarchive handlers re-fetch with the current `pickerShowArchived` so the row state stays consistent after mutation.
- `App`'s `getProjects` prop signature changed from `() => ProjectRecord[]` to `(opts: { includeArchived: boolean }) => ProjectRecord[]`. The default delegates straight to `listProjects(opts)`. Existing call sites that pass `getProjects={() => [alpha]}` keep working — TS allows fewer-param functions to satisfy the wider signature.
- New `unarchiveProjectFn?: (name: string) => void` prop on `App`, defaulting to `unarchiveProject` from `projects.ts`.
- Added 5 new tests in `project-picker-overlay.test.tsx` covering the 'A' toggle, the New-buffer regression for 'A', archived-row → unarchive routing, the "(archived)" visual marker, and two App-level flows (toggle exposes gamma via `getProjects({includeArchived: true})`; pressing 'a' on an archived row routes to `unarchiveProjectFn`).

**Files touched:**
- `apps/cli/src/tui/ProjectPickerOverlay.tsx`
- `apps/cli/src/tui/App.tsx`
- `apps/cli/src/__tests__/project-picker-overlay.test.tsx`

**Feedback loop result:** `pnpm vitest run` → 23 files, 281 tests passing (5 new). `tsc --noEmit` clean. `pnpm lint` still fails for the same pre-existing reason (no `eslint.config.js` in `apps/cli`) — not caused by this slice.

**Notes for downstream slices / future work:**
- I added a literal " (archived)" suffix to archived rows in addition to `dimColor`. The motivation was test-determinism: in the vitest environment `chalk` disables ANSI codes (no isatty, FORCE_COLOR unset) so a pure dim-color assertion always failed in monochrome. The suffix doubles as accessibility for NO_COLOR users. If anyone wants to drop the suffix later, the alternative is forcing `FORCE_COLOR=1` via `test.env` in `vitest.config.ts` and asserting on `\x1b[2m...\x1b[22m` wrapping — but that affects every test file's output.
- The picker's bottom hint ("↑↓ navigate · enter select · esc close") was intentionally **not** updated to advertise `a` / `A`. Both the prior `tui-archive-key` slice and this one left it untouched; if a UX-discoverability pass is desired it would be a clean, isolated polish slice (also worth mirroring the bindings into `HelpOverlay`, which is the global-keybindings reference — note that `a`/`A` are picker-local, not global, so they may not belong there).
- `menubar-manage-projects` is independent of this slice (no shared code) but should mirror the same naming: an "Archive" button on active rows and "Unarchive" on archived rows, plus a "Show archived" toggle. The CLI primitives are already exposed; that slice just needs new `PmdrClient` methods for `archive` / `unarchive` subcommands.

## 2026-05-21 — `menubar-manage-projects`

**Status:** needs-review (`Human checkpoint: yes` — GUI behaviour needs to be eyeballed by running the app)

**What changed:**
- Extended `PmdrClient` with `archiveProject(_:)`, `unarchiveProject(_:)`, and an `includeArchived: Bool = false` parameter on `listProjects(...)` that appends `--include-archived` to the CLI call when true. Default remains `false` so existing callers keep their semantics.
- Added a new `ManageProjectsWindowController` (`apps/menubar/Sources/ManageProjectsWindowController.swift`) — a modeless `NSWindow` with a Show-archived checkbox (default ON), an `NSTableView` listing every project with name + per-row Archive/Unarchive button, and an inline error alert path. Mutations go through `PmdrClient.archiveProject/unarchiveProject`; after each action it re-fetches `listProjects(includeArchived: true)` and re-renders. Toggling the checkbox just re-filters the cached list.
- Wired into the menu via a new "Manage projects…" `NSMenuItem` inserted just above the Quit separator in every state (idle / running / paused). `AppDelegate` lazily constructs the controller and reuses it across opens.
- Added 4 unit tests (`PmdrClientArgvTests`) that point the client at a stub `pmdr` shell script which logs its argv. Asserts:
  - `listProjects(includeArchived: true)` → `project list --json --include-archived`
  - `listProjects()` → `project list --json` (no flag)
  - `archiveProject("alpha")` → `project archive alpha`
  - `unarchiveProject("alpha")` → `project unarchive alpha`

**Files touched:**
- `apps/menubar/Sources/PmdrMenubarCore/PmdrClient.swift`
- `apps/menubar/Sources/ManageProjectsWindowController.swift` (new)
- `apps/menubar/Sources/AppDelegate.swift`
- `apps/menubar/Tests/PmdrMenubarCoreTests/PmdrClientTests.swift`
- `apps/menubar/pmdr-menubar.xcodeproj/project.pbxproj` (regenerated via `xcodegen`)

**Feedback loop result:** `xcodebuild test` → 57 tests, 0 failures, 3 integration tests skipped (require `PMDR_INTEGRATION=1`). The 4 new `PmdrClientArgvTests` all pass.

**Why `needs-review` not `done`:** Per the tasks file the slice has `Human checkpoint: yes`, and the feedback loop explicitly calls for manual verification (open Manage projects, archive a test project, toggle Show archived off/on, unarchive it). The window-controller code is structural — table backing, button wiring, refresh loop — none of which is exercised by a headless test. Reviewer should:
1. Build & run `pmdr-menubar`.
2. Open the menubar menu → Manage projects… — confirm a window appears.
3. Confirm the row list matches `pmdr project list --include-archived --json` ordering and that archived rows render dimmed (tertiary label colour).
4. Click Archive on an active project → row's button flips to Unarchive; toggle Show archived off → row disappears; toggle back on → row reappears as Unarchive.
5. Click Unarchive → row flips back to Archive.
