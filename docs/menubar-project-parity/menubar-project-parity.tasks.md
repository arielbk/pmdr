# Menubar Project Parity

Brings the menubar app to parity with the TUI's project picker: start with no project, switch the project of a running session, with the CLI affordances needed to support it.

## Slices

### `cli-start-no-project` — Allow non-TTY `start` without `--project`

**Status:** done

**Outside-in:** `pmdr start` invoked with no `--project` flag and no TTY succeeds, attributing the focus block to `(unassigned)` instead of erroring.

**Feedback loop:** Extend `start.test.ts` with a case asserting the no-`--project` non-TTY path succeeds and writes state with `project: "(unassigned)"`.

**Human checkpoint:** no

**Depends on:** none

### `cli-project-set` — `pmdr project set` subcommand

**Status:** done

**Outside-in:** `pmdr project set <name>` reassigns the running (or paused) session's project, auto-creating the project on unknown names. `pmdr project set --none` clears it to `(unassigned)`. Errors with a clear message when no session is running, when both `<name>` and `--none` are given, when neither is given, and when `<name>` is the reserved `(unassigned)` sentinel.

**Feedback loop:** New `project-set.test.ts` mirroring the `project-rename` / `project-archive` test style — seeds state via the same modules, asserts on the resulting state file. Covers: reassign to existing project, auto-create on unknown name, clear to `(unassigned)`, no-session error, mutually exclusive flags, missing args, reserved-sentinel name.

**Human checkpoint:** no

**Depends on:** none

### `menubar-start-none` — "None" in Start submenu

**Status:** needs-review

**Outside-in:** From the menubar in idle state, clicking the icon → Start → None begins a focus block with no project. `pmdr status --json` shows the session attributed to `(unassigned)`.

**Feedback loop:** Manual — `pnpm menubar`, launch the app in idle state, click the menubar icon, open the Start submenu, confirm "None" appears below the project list and above "New project...". Click it. Run `pmdr status --json` in a terminal and confirm `project` is `"(unassigned)"`.

**Human checkpoint:** yes

**Depends on:** `cli-start-no-project`

### `menubar-change-project` — Change project mid-session

**Status:** needs-review

**Outside-in:** While a session is running or paused, the menubar shows a "Change project" item (replacing the previously-disabled `"Project: X"` label) whose submenu lists all non-archived projects + None + "New project...", with a checkmark next to the currently active project. Selecting any item reassigns the live session and the checkmark moves on the next menu open.

**Feedback loop:** Manual — start a session with project A from the menubar. Open the menu, confirm the disabled label is gone and "Change project" is present. Open its submenu, confirm A is checkmarked. Switch to B; confirm `pmdr status --json` shows B and the checkmark follows on reopen. Repeat: switch to None (status shows `(unassigned)`, checkmark on None). Repeat: switch to a brand-new project via "New project..." (project is created, session reattributed). Repeat the whole flow with the session paused.

**Human checkpoint:** yes

**Depends on:** `cli-project-set`
