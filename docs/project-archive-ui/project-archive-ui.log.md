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
