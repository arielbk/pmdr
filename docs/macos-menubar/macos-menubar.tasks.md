# macOS Menubar App

A native Swift macOS menubar app that surfaces pmdr's timer in the system tray, with start / pause / stop, project picker, global toggle hotkey, and phase-end notifications. Thin shell over the existing CLI — all mutations shell out to `pmdr`, all reads come from polling `pmdr status --json`.

## Slices

### `app-skeleton` — Xcode project + static tray icon

**Status:** needs-review

**Outside-in:** Launching the `.app` puts a `pmdr` label / icon in the macOS menubar with a one-item menu ("Quit").

**Feedback loop:** Manual — `xcodebuild` or run from Xcode, confirm the status item appears in the menubar and Quit terminates the app.

**Human checkpoint:** no

**Depends on:** none

---

### `pmdr-client` — Typed Swift client for the CLI

**Status:** not-started

**Outside-in:** `PmdrClient.status() async throws -> Status` where `Status` is an enum mirroring `StatusResult` in `apps/cli/src/commands/status.ts`. Throws a typed `.binaryNotFound` error when `pmdr` is not on PATH.

**Feedback loop:** Integration test against the real `pmdr` binary in a temp state dir: idle status decodes, running status decodes after `pmdr start --force --project test`, paused status decodes after `pmdr pause`, and a fake PATH surfaces `.binaryNotFound`.

**Human checkpoint:** no

**Depends on:** none

---

### `live-title` — Tray title ticks from poller

**Status:** not-started

**Outside-in:** With a focus block running (started via the TUI), the menubar title shows `M:SS` remaining and counts down live. When idle, the title is empty (icon only).

**Feedback loop:**
- Pure unit tests of `StatusPoller`: given a sequence of stubbed `PmdrClient.status()` results, it publishes the expected status changes and phase-transition events, and switches cadence on menu-open / menu-close signals.
- Manual: start a session in the TUI, watch the menubar tick down second-by-second; close the menu and confirm cadence relaxes (no visible jank but state stays correct on next poll).

**Human checkpoint:** yes

**Depends on:** app-skeleton, pmdr-client

---

### `menu-actions` — State-dependent menu with Pause / Resume / Stop / Start (last project)

**Status:** not-started

**Outside-in:** Clicking the tray opens a menu whose items depend on current state:
- Idle → "Start (last project)" (disabled if no last-used project), Quit.
- Running → "Pause", "Stop", current project label, Quit.
- Paused → "Resume", "Stop", current project label, Quit.

Last-used project is read from the most recent line of `~/.local/state/pmdr/completions.jsonl`.

**Feedback loop:**
- Assertion test of `StatusItemController`: for each status variant, the menu items and enabled-states match the spec above.
- Manual: with a session running in the TUI, click Pause from the menu → TUI reflects paused state within one poll cycle. Same for Resume, Stop, and Start.

**Human checkpoint:** no

**Depends on:** live-title

---

### `project-picker` — Submenu of projects + "New project…"

**Status:** not-started

**Outside-in:** The Idle-state menu's "Start" item becomes a submenu listing active (non-archived) projects with a "New project…" entry at the bottom. Clicking a project starts a focus block on it. "New project…" opens an `NSAlert` with a text field; submitting starts a focus block on that project (creating it via `pmdr start --force --project <name>`, which upserts).

**Feedback loop:** Manual — open the submenu, pick an existing project, confirm a focus block starts on it (visible in the menubar title and in the TUI). Use "New project…" to add a never-before-seen name, confirm it appears in `projects.json` and a focus block starts.

**Human checkpoint:** no

**Depends on:** menu-actions

---

### `hotkey-toggle` — Global ⌃⌥⌘P state-dependent toggle

**Status:** not-started

**Outside-in:** Pressing ⌃⌥⌘P anywhere on the system:
- If idle → starts a focus block on the last-used project. If no last-used project exists, opens the tray menu instead of starting silently.
- If running → pauses.
- If paused → resumes.

If hotkey registration fails (e.g. another app owns the combo), a one-time alert surfaces the conflict.

**Feedback loop:**
- Unit test of `HotkeyManager`'s state→action mapping table with injected status.
- Manual: from any app, press the hotkey across all three states and confirm the expected transition fires; trigger a deliberate conflict (register the same combo in another app first) and confirm the alert.

**Human checkpoint:** yes

**Depends on:** menu-actions

---

### `phase-notifications` — Banner on phase transitions

**Status:** not-started

**Outside-in:** When the poller observes a focus→break transition, a native banner says "Focus done — break started". On break→idle, "Break done". One banner per transition, no sound config, no settings.

**Feedback loop:** Manual — start a short focus block (e.g. `pmdr start --duration 10s --force --project test`) from a terminal, leave the menubar app running, confirm the focus-end banner fires once at expiry. Let the break run out and confirm the break-end banner fires once. Verify no duplicate banners on subsequent polls.

**Human checkpoint:** no

**Depends on:** live-title
