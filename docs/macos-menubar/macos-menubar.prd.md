# PRD: macOS Menubar App

## Problem Statement

The pmdr CLI's interactive TUI is great when a terminal window is open and focused, but day-to-day pomodoro use happens in the background while the user works in other apps. To check the timer or pause a session, the user has to switch to the terminal — friction that defeats the purpose of an ambient productivity tool. There is no glanceable surface and no way to start, pause, or stop without context-switching.

## Solution

A native Swift macOS menubar app that shows the remaining time in the system tray at all times, exposes start / pause / stop and a project picker via the tray menu, supports a global hotkey for one-press toggle (start / pause / resume), and surfaces a banner notification when each phase ends. The app is a thin shell: all state mutations go through the existing `pmdr` CLI, and all reads come from polling `pmdr status --json`. The CLI/TUI remains the single source of truth.

## User Stories

1. As a focused user, I want to glance at the menubar and see how much time is left in the current focus block, so that I don't have to switch to the terminal.
2. As a user mid-flow, I want to press a global hotkey to pause the timer when interrupted (and press it again to resume), so that pausing costs zero context switches.
3. As a user starting a session, I want to click the menubar icon and pick an existing project from a submenu (or create a new one inline), so that I can begin a focus block without opening a terminal.
4. As a user finishing a block, I want a single native banner when focus ends and another when the break ends, so that I'm pulled back to action without watching the clock.
5. As a user who already has the TUI open, I want the menubar and TUI to stay in sync, so that I can use whichever surface is convenient at any moment.
6. As a user, I want the tray icon to visually reflect state (idle vs running vs paused vs break), so that I can tell at a glance whether a session is active.
7. As a first-time user, I want a clear error if `pmdr` isn't on my PATH, with the install command surfaced, so that setup failure isn't mysterious.

## Implementation Decisions

### App shell
- **Stack:** Native Swift / AppKit, packaged as a standard `.app`. SwiftUI is acceptable inside menu content where it simplifies the picker UI, but the status item itself is `NSStatusItem`.
- **Location in monorepo:** `apps/menubar/` — sibling of `apps/cli`. Not wired into Turbo (separate Xcode toolchain). Build/run is `xcodebuild` or opening the `.xcodeproj` directly.
- **Binary discovery:** Resolve `pmdr` from `PATH`. On first launch (or any `pmdr` invocation that fails with "command not found"), surface a one-time alert with the install command. No configurable path in v1.

### State synchronisation
- **Read model:** Poll `pmdr status --json` on a single interval. Use 1s when the menu is open and the user is interacting; back off to 5s when the menu is closed. The `status` command already calls `advancePhaseIfExpired` as a side effect, so polling drives phase transitions for free — no separate tick endpoint needed.
- **Write model:** Shell out to the CLI for every mutation. The relevant commands already exist:
  - Start: `pmdr start --force --project <name>` (optionally `--duration` later)
  - Pause: `pmdr pause`
  - Resume: `pmdr resume`
  - Stop: `pmdr stop`
- **Phase transition detection:** Compare the previous poll's `state`/`phase`/`completedFocusBlocks` to the current poll's. When focus → break or break → idle, fire a notification.

### Project picker
- Submenu under "Start…" listing the active (non-archived) projects, plus a "New project…" item at the bottom that opens a small NSAlert with a text field.
- Project list is fetched from `pmdr project list --json` (verify this command exists or adapt; if it doesn't, the menubar reads `~/.local/state/pmdr/projects.json` directly — same source of truth, atomic writes).
- Picking a project starts a focus block immediately on it. No duration choice in v1 (uses CLI default).

### Tray icon & menu
- Title shows `M:SS` remaining when running or paused; nothing (or just the icon) when idle.
- Menu contents vary by state:
  - **Idle:** "Start…" submenu (projects + new), Quit.
  - **Running:** "Pause", "Stop", current project label, Quit.
  - **Paused:** "Resume", "Stop", current project label, Quit.
- Icon variant (filled / outlined / colored) reflects state so even users hiding text titles can tell at a glance.

### Global hotkey
- Single hardcoded toggle: **⌃⌥⌘P** (Ctrl+Opt+Cmd+P). Behavior is state-dependent:
  - Idle → start a focus block on the last-used project (read from the most recent `state.json` or `completions.jsonl` entry). If no last project exists, the hotkey opens the tray menu instead of starting silently.
  - Running → pause.
  - Paused → resume.
- Registration via Carbon `RegisterEventHotKey` or a small wrapper like `HotKey` (single-file Swift dependency). No conflict UI; if registration fails (collision with another app), log and surface a one-time alert.

### Notifications
- One `UNUserNotificationCenter` banner per phase transition:
  - Focus → Break: "Focus done — break started"
  - Break → Idle: "Break done"
- No sound config, no per-project customisation, no persistence of dismissed notifications.
- Request notification permission on first launch.

### Module sketch (Swift side)
The Swift app naturally decomposes into a few small, testable units. Inside `apps/menubar/`:

- **`PmdrClient`** — shells out to the CLI. Async functions for `status()`, `start(project:)`, `pause()`, `resume()`, `stop()`, `listProjects()`. Owns "binary not found" detection. Deep module: hides Process / stdio / JSON-decoding complexity behind a typed interface.
- **`StatusPoller`** — wraps `PmdrClient.status()` in a timer with adaptive cadence (1s / 5s). Publishes status changes and phase-transition events. Pure state machine over the poll results — easy to unit-test by feeding fake status sequences.
- **`StatusItemController`** — owns the `NSStatusItem`, renders title/icon for a given status, builds the menu for a given state. Driven by `StatusPoller`.
- **`HotkeyManager`** — registers the global shortcut, maps presses to actions based on current status.
- **`NotificationCenter`** (thin wrapper) — `notifyPhaseEnd(.focusToBreak | .breakToIdle)`. Easy to stub in tests.

### Distribution
- No code signing, no notarization in v1. Local Xcode build, drag to `/Applications` (or `~/Applications`) manually.
- No auto-launch on login. (User can add via System Settings → General → Login Items if desired.)
- No auto-update mechanism.

## Testing Decisions

- **`PmdrClient`** — integration-test against the real `pmdr` binary in a temp `XDG`-style state dir. Verify: idle status decodes, running status decodes, start/pause/resume/stop round-trip a session, "binary not found" surfaces a typed error. This is the highest-value test surface because it's the seam between the two languages.
- **`StatusPoller`** — pure unit tests with an injected clock and a stubbed `PmdrClient`. Verify: phase-transition events fire exactly once per transition, cadence switches on menu open/close, no spurious events when poll results are identical.
- **`StatusItemController`** — snapshot test (or assertion test) the title/menu structure for each status variant: idle, running-focus, running-break, paused-focus, paused-break.
- **`HotkeyManager`** — unit-testable by injecting the action dispatcher; verify state → action mapping table. Don't test the OS-level registration itself.
- Skip UI-level tests of the actual `NSStatusItem` rendering — high cost, low signal.
- Prior art in the CLI uses Vitest with module factories (`createStateModule(stateDir)`) for isolation. Mirror that pattern in Swift via constructor injection.

## Out of Scope

- Today's view (completions grouped by project) — use TUI.
- Project rename, archive, unarchive — use TUI / CLI.
- Mid-session project switch — stop and restart instead.
- 8-block focus goal display.
- User-configurable hotkey (single hardcoded combo only).
- Notification settings (sound, suppression windows, per-project).
- Auto-launch on login.
- Code signing, notarization, auto-update.
- Bundled Node runtime / bundled `pmdr` binary inside the `.app`.
- Electron or any non-native shell.
- iOS / iPad version.
- Re-implementation of state derivation in Swift — all reads go through `pmdr status --json`.

## Open Questions

- Does `pmdr project list --json` exist? If not, decide whether to add it or have the menubar read `projects.json` directly. Both are acceptable; the JSON command is cleaner but the direct read is zero CLI work.
- "Last-used project" for the hotkey-start case: derive from the most recent `completions.jsonl` entry, or persist separately in the menubar app's own prefs? Cheapest is to read the last line of `completions.jsonl`.
