# Project archive UI

Expose the existing project archive/unarchive primitive in both the TUI and the macOS menubar app so test/stale projects can be hidden (and restored) without dropping to the CLI. History on past completions is preserved; hard delete is explicitly out of scope.

## Slices

### `tui-archive-key` — TUI archive keybinding

**Status:** done

**Outside-in:** In the TUI ProjectPickerOverlay, pressing `a` on a highlighted active project archives it via the existing `archiveProject` primitive and the row disappears from the picker on the next render.

**Feedback loop:** Unit test on the overlay asserting that `a` on a highlighted row calls `archiveProject` with the right name and the row is filtered out on rerender. Existing picker tests cover the `includeArchived: false` filter.

**Human checkpoint:** no

**Depends on:** none

### `tui-show-archived` — TUI show-archived toggle and unarchive

**Status:** done

**Outside-in:** In the same picker, pressing `A` (shift+a) toggles a "show archived" mode that lists archived projects dimmed alongside active ones; pressing `a` on a dimmed (archived) row unarchives it.

**Feedback loop:** Unit test asserting the `A` toggle flips visibility (overlay calls `listProjects` with `includeArchived: true`), and `a` on an archived row calls `unarchiveProject`. Snapshot or render assertion confirms archived rows render dimmed.

**Human checkpoint:** no

**Depends on:** `tui-archive-key`

### `menubar-manage-projects` — Menubar Manage Projects window

**Status:** not-started

**Outside-in:** A new top-level "Manage projects..." `NSMenuItem` in the menubar opens a native window listing every project as a row with its name and an Archive/Unarchive button. A "Show archived" toggle at the top defaults to ON; flipping it off hides archived rows. Actions invoke the existing pmdr CLI archive/unarchive subcommands via `PmdrClient`.

**Feedback loop:** Swift unit tests for any new `PmdrClient` methods (archive/unarchive) following the existing `PmdrClientTests` pattern. Window itself verified manually by running the menubar app, archiving a test project, toggling "Show archived" off and on, and unarchiving it.

**Human checkpoint:** yes

**Depends on:** none
