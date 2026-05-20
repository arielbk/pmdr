# PRD: Menubar Project Parity

## Problem Statement

The TUI lets the user start a pomodoro with no project (the `(unassigned)` sentinel) and switch the project of a running session at any time. The menubar app can do neither: the Start submenu lists projects and "New project..." but offers no way to start unassigned, and the running/paused menu shows the current project as a disabled label with no affordance to change it. The user has to drop into a terminal to do either thing — exactly the friction the menubar exists to eliminate.

The CLI itself is also a step behind: `pmdr start` errors out when invoked without `--project` in a non-TTY context, and there is no subcommand to reassign the project of a running session. The TUI achieves mid-session switching by writing the state file directly, which the menubar (a thin shell over the CLI) cannot do.

## Solution

Close the gap on both surfaces.

In the CLI, `pmdr start` becomes permissive in non-TTY mode: with no `--project`, it starts a pomodoro attributed to `(unassigned)` instead of erroring. A new `pmdr project set` subcommand reassigns the project of a running (or paused) session; `pmdr project set --none` drops it back to `(unassigned)`. Auto-creation on unknown names mirrors the existing `start --project` behaviour.

In the menubar, a single project-picker submenu — projects + None + "New project..." — is used in two places: the idle "Start" item (unchanged in spirit, gains "None") and a new "Change project" item in the running/paused menu (replacing the disabled `"Project: X"` label). The submenu shows a checkmark next to the currently active project during a session.

## User Stories

1. As a user in the menubar, I want to pick "None" from the Start submenu, so that I can begin a focus block without committing to a project up front.
2. As a user mid-session, I want to open the menubar menu and switch the active session's project, so that an interruption doesn't force me into a terminal.
3. As a user mid-session, I want to clear the active session's project (set it back to "None"), so that I can decouple a block from a project I no longer want it attributed to.
4. As a user mid-session, I want to create a new project from the running-state submenu, so that I can attribute the block I'm already working on to something I hadn't pre-seeded.
5. As a user, I want a checkmark next to the currently active project in the running-state submenu, so that I can see at a glance what the session is attributed to.
6. As an agent or script, I want `pmdr start` with no `--project` and no TTY to succeed and attribute the block to `(unassigned)`, so that lightweight automations don't need to manage project names just to start a timer.
7. As an agent or script, I want `pmdr project set <name>` to reassign the running session's project (auto-creating the project on first use), so that mid-session attribution is scriptable end-to-end.
8. As an agent or script, I want `pmdr project set --none` to clear the running session's project, so that I have an explicit handle for the "unassign" operation.
9. As an agent or script, I want `pmdr project set` to fail loudly when no session is running, so that misuse doesn't silently no-op.

## Implementation Decisions

### CLI: `start` permissiveness

The non-TTY guard in `start` is removed for the no-`--project` case. With no `--project` flag and no TTY, the command proceeds and `initTimer` falls through to its existing default (`(unassigned)`). All other start behaviour is unchanged. The existing TTY-interactive picker path is untouched.

### CLI: `pmdr project set`

A new subcommand under the existing `project` command group. Signature:

- `pmdr project set <name>` — reassign the running session to the named project. Auto-create the project if it doesn't exist (reusing the same `upsertProject` path as `start --project`).
- `pmdr project set --none` — clear the running session's project, attributing it to `(unassigned)`.

Errors:

- No session running → exit with a clear error.
- Both `<name>` and `--none` provided → exit with a clear error.
- Neither provided → exit with a clear error (prints usage).
- `<name>` resolves to the reserved `"(unassigned)"` sentinel → exit with the existing reserved-sentinel error already enforced by the projects module.

Mutation semantics: read the live state file, swap the `project` field, write atomically. No event log entry is appended (this is a correction, not a phase transition); if the event log later needs a "project reassigned" entry, it's a follow-up.

### CLI: paused sessions

`project set` operates on both running and paused sessions. The TUI's switch-while-paused behaviour is already supported by the same direct-state-write path; the new command matches it.

### Menubar: shared picker submenu

A single helper assembles the project-picker submenu. It takes a "current project" parameter (nullable) and emits, in order:

1. One menu item per non-archived project, with `.state = .on` when the project name matches `current`.
2. A "None" item, with `.state = .on` when `current` is nil.
3. A separator.
4. A "New project..." item that opens the existing inline-input alert.

Each non-action item is wired to an action selector parameterised by the menu surface (idle Start vs. running Change). The two surfaces differ only in which action they invoke on the `PmdrClient`.

### Menubar: idle Start menu

The existing "Start" item's submenu is replaced by the shared picker, passing `current = nil`. Selecting a project calls `start(project:)`; selecting "None" calls a new no-project `start()`; "New project..." retains its current alert flow and routes through `start(project:)` after capturing the name.

### Menubar: running/paused menu

The disabled `"Project: X"` label is replaced by a "Change project" item with the shared picker as its submenu, passing `current = active.project`. Selecting a project calls `setProject(_:)`; selecting "None" calls `setProject(nil)`; "New project..." routes through `setProject(_:)` after capturing the name.

### Menubar: `PmdrClient` additions

Two new methods on the CLI shell:

- `start()` — invokes `pmdr start --force --detach` with no `--project`.
- `setProject(_ name: String?)` — invokes `pmdr project set <name>` or `pmdr project set --none`.

Both follow the existing `run(arguments:)` plumbing and the existing error-surfacing path through `performClientAction`.

## Testing Decisions

Two CLI test files, both following the prior-art style of `project-rename` and `project-archive`:

- A `project-set` test: covers the success cases (reassign to existing project, auto-create on unknown name, clear to `(unassigned)`) and the error cases (no session running, mutually exclusive flags, reserved-sentinel name, missing args). Mirrors the `project-rename` test's pattern of seeding state via the same modules the command uses and asserting on the resulting state file.
- A `start` test extension (or a focused new file): covers the new non-TTY no-`--project` success path, asserting the session is attributed to `(unassigned)`. The existing `start.test.ts` is the natural home and contains the closest patterns.

No menubar tests. The menubar work is presentation-layer plumbing over CLI calls; the value is exercised by using the app, and adding a test harness for AppKit menu construction is out of proportion to the risk.

## Out of Scope

- Customisable keyboard shortcuts in the menubar. Would require introducing a settings-window subsystem the app does not currently have (no `UserDefaults`, no preferences UI, no `NSWindow`). Tracked as a separate follow-up.
- Event-log entries for project reassignment. The current event log records phase transitions; whether reassignment deserves its own event is a separate question for the projects/event-log surface.
- Re-attributing already-completed log entries from the menubar. Historical edits remain CLI-only.
- Changing how `(unassigned)` is rendered in any other surface (status output, `today`, etc.).
