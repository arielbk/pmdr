# PRD: Floating Timer Window

## Problem Statement

When I'm working in a fullscreen app (e.g. Figma, an editor in fullscreen mode, a video call), the menu bar is hidden and I can't see my active pomodoro. I have to swipe out of the fullscreen Space or wait for a phase-end notification to know where I am in the block. That breaks focus and defeats the point of running a pomodoro in the background.

## Solution

A borderless floating window that displays the active pomodoro's time, phase, and project name. It is summoned and dismissed with a global hotkey, floats above fullscreen apps, follows me across Spaces, and stays where I drag it. It has no controls — it's a glanceable readout, not a second copy of the menubar UI. Start/pause/resume continue to live on a separate hotkey and on the menubar icon.

## User Stories

1. As a user in a fullscreen app, I want to press a hotkey to see my pomodoro's remaining time without leaving the Space, so that I can stay focused.
2. As a user, I want to press the same hotkey again to hide the window, so that toggling is a single muscle-memory action.
3. As a user, I want to drag the floating window anywhere on screen, so that it doesn't cover the part of the underlying app I'm using.
4. As a user, I want the window to reappear in the same position the next time I summon it — within the session and after restarting the app — so that I don't have to reposition it each time.
5. As a user with multiple displays, I want the window to appear on the display I'm currently using, so that I don't have to look at my other monitor to find it.
6. As a user, I want the window to show the current phase (focus vs break), so that a number like `04:23` is unambiguous about which block I'm in.
7. As a user, I want the window to show the current project name, so that I can confirm at a glance the timer is for the work I think it is.
8. As a user with no active timer, I want pressing the hotkey to still show a window (with an idle placeholder), so that the hotkey behaves predictably and confirms the app is alive.
9. As a user, I want the window to stay where I put it when I click in another app, so that it doesn't disappear the moment I tab back to my editor.
10. As a user, I want to start, pause, and resume the timer with `⌥⌘Return`, so that the timer-control hotkey is distinct from the show/hide-window hotkey.
11. As a user, I want the show/hide hotkey to be `⌃⌥⌘P`, taking over the binding currently used for start/pause, so that the most reachable combo is bound to the most frequent action (peeking).

## Implementation Decisions

### New module: `FloatingTimerWindowController`
- Owns a borderless `NSPanel` with `styleMask = [.borderless, .nonactivatingPanel]`, `isFloatingPanel = true`, `level = .floating`, `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]`, `hidesOnDeactivate = false`.
- Whole-window drag enabled (`isMovableByWindowBackground = true`).
- `toggle()` shows/hides; show places the panel at the persisted position for the active display, or a sensible default near the top-right of that display if no position is remembered.
- Receives status updates from `AppDelegate` and renders via `FloatingTimerViewModel`.
- Tracks `NSWindow.didMoveNotification` to persist position on drag end.
- Subscribes to `NSApplication.didChangeScreenParametersNotification` to gracefully handle display add/remove (fall back to active display).

### New module: `FloatingTimerPosition` (deep, pure)
- Read/write per-display position to `UserDefaults` under a single key (e.g. `floatingTimer.positions`) holding a `[displayKey: NSPoint]` map.
- `displayKey` derived from `NSScreen` identifier (`localizedName` is unreliable; use `displayID` from `deviceDescription[.screenNumber]` or `CGDirectDisplayID` — pick one and document it).
- Public surface:
  - `func position(for screen: NSScreen) -> NSPoint?`
  - `func record(_ point: NSPoint, for screen: NSScreen)`
  - `func defaultPosition(for screen: NSScreen, windowSize: NSSize) -> NSPoint` (top-right anchor with a small inset).
- No AppKit window logic — pure data + screen identification.

### New module: `FloatingTimerViewModel` (deep, pure)
- Pure mapping from `(Status, lastUsedProject: String?)` → renderable strings:
  - `time: String` — `"MM:SS"` from `remainingMs` when running/paused; `"--:--"` when idle.
  - `phaseLabel: String` — `"focus"`, `"break"`, or `"idle"`.
  - `projectName: String` — active project when running/paused; last-used project when idle; empty string when neither exists.
  - `isMuted: Bool` — true when idle, used by the view to render dimmer.
- Mirrors the shape of the existing `TitleFormatter` but returns structured fields rather than a single string.

### Refactor: `HotkeyManager`
- Generalise to register an arbitrary number of hotkeys with distinct `EventHotKeyID`s and per-binding callbacks. Keep the same Carbon-based approach; the existing single-callback constructor goes away.
- Suggested surface:
  - `register(keyCode: UInt32, modifiers: UInt32, handler: @escaping @MainActor () -> Void) throws -> Int` (returns a registration id, used for unregister).
  - `unregisterAll()` on deinit.
- The single event handler dispatches by `hotKeyID.id` to the right callback.

### Hotkey binding changes
- `⌃⌥⌘P` (`kVK_ANSI_P`, `controlKey | optionKey | cmdKey`) → toggle floating timer window (new role).
- `⌥⌘Return` (`kVK_Return`, `optionKey | cmdKey`) → existing start/pause/resume action.
- Hotkeys are **not configurable** in this iteration. A follow-up will add configuration once usage warrants it.

### `AppDelegate` wiring
- Construct the `FloatingTimerWindowController` during `applicationDidFinishLaunching`.
- On each status poll completion, push the new `Status` (and `lastUsedProject()` result) to the controller alongside `updateIcon` / `redrawTitle`.
- Replace the single `registerHotkey()` call with two registrations against the refactored `HotkeyManager`.

### State during paused timer
- Render the frozen `MM:SS` as-is. Phase label remains `focus` or `break`. The window is not blinked or dimmed for paused state — the menubar icon already conveys paused state, and adding a second indicator here is out of scope until requested.

## Testing Decisions

- **`FloatingTimerPosition`** — unit tests with an in-memory `UserDefaults` (`UserDefaults(suiteName:)`). Cover: round-trip read/write per display, multiple displays coexisting, returning `nil` when no record exists, `defaultPosition` placement math against representative screen frames.
- **`FloatingTimerViewModel`** — unit tests over a matrix of `Status` cases: idle (with and without `lastUsedProject`), running focus, running break, paused focus, paused break. Verify `time`, `phaseLabel`, `projectName`, `isMuted` for each.
- **`HotkeyManager`** — minimal smoke test that two registrations with distinct key/modifier combinations both succeed and route to their own callback. Deeper testing limited by Carbon's process-global hotkey table.
- **`FloatingTimerWindowController`** — not unit tested (AppKit-heavy). Covered by manual QA: see Done When in the spec session.
- Prior art: existing tests live under `apps/menubar/Tests/`; mirror that structure. `TitleFormatter` is the closest pure-formatter precedent for `FloatingTimerViewModel`.

## Out of Scope

- In-window timer controls (start/pause/stop buttons).
- Auto-show on phase transition, timer start, or session complete.
- Window chrome (title bar, traffic-light close button).
- Click-outside-to-dismiss.
- Configurable hotkeys (deferred until users start reporting collisions).
- Showing completions-today, session stats, or any dashboard data in the window.
- A separate visual state for paused (beyond the frozen time).
- Custom window sizing or user-resizable layout.

## Open Questions

- Exact window dimensions and font sizes for the readout — should be tuned during implementation against a fullscreen app to confirm legibility at typical viewing distance. Suggested starting point: ~180×60pt, time in a large monospaced digit font.
- Default position anchor on first show — top-right of the active display with a ~16pt inset is the proposed default; confirm during QA.
- Display-identification strategy — `CGDirectDisplayID` via `deviceDescription[.screenNumber]` is the most stable across reboots; verify it survives plugging/unplugging an external display without losing the saved position.
