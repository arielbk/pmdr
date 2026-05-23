# Floating Timer Window

Borderless floating panel that shows the active pomodoro's time, phase, and project — summoned by `⌃⌥⌘P`, pierces fullscreen, draggable with per-display position memory. Start/pause/resume moves to `⌥⌘Return`.

## Slices

### `hotkey-rewire` — Rewire HotkeyManager for multiple bindings

**Status:** done

**Outside-in:** Pressing `⌥⌘Return` while the menubar app is running starts an idle timer (or pauses/resumes a running/paused one), matching the current `⌃⌥⌘P` behavior. `⌃⌥⌘P` is temporarily unbound after this slice (re-bound in `panel-skeleton`).

**Feedback loop:** Smoke test in `apps/menubar/Tests/` that two registrations with distinct key/modifier combinations both succeed and route to their own callback. Manual: launch the menubar app, press `⌥⌘Return` from any app and confirm timer start/pause/resume via `pmdr status`.

**Human checkpoint:** no

**Depends on:** none

---

### `view-model` — FloatingTimerViewModel pure mapping

**Status:** done

**Outside-in:** `FloatingTimerViewModel(status: Status, lastProject: String?)` exposes `time`, `phaseLabel`, `projectName`, `isMuted`. Idle → `"--:--"`, `"idle"`, last project (or `""`), `isMuted: true`. Running focus → `"MM:SS"`, `"focus"`, active project, `isMuted: false`. Same for running break and paused variants (paused renders frozen `MM:SS`, `isMuted: false`).

**Feedback loop:** Unit tests in `apps/menubar/Tests/PmdrMenubarCoreTests/` covering the full matrix: idle (with and without last project), running focus, running break, paused focus, paused break.

**Human checkpoint:** no

**Depends on:** none

---

### `position-store` — FloatingTimerPosition per-display persistence

**Status:** done

**Outside-in:** `FloatingTimerPosition` exposes `position(for: NSScreen) -> NSPoint?`, `record(_ point: NSPoint, for: NSScreen)`, `defaultPosition(for: NSScreen, windowSize: NSSize) -> NSPoint`. Backed by a `UserDefaults` suite with a single key holding a `[displayKey: NSPoint]` map keyed by `CGDirectDisplayID` from `NSScreen.deviceDescription[.screenNumber]`.

**Feedback loop:** Unit tests using an in-memory `UserDefaults(suiteName:)`: round-trip per display, multi-display coexistence, returns `nil` for unknown display, `defaultPosition` produces a top-right anchor with the expected inset for representative screen frames.

**Human checkpoint:** no

**Depends on:** none

---

### `panel-skeleton` — Borderless fullscreen-piercing panel toggled by hotkey

**Status:** needs-review

**Outside-in:** Pressing `⌃⌥⌘P` in any app — including a fullscreen app on a separate Space — summons a small borderless `NSPanel` that floats above that app; pressing again hides it. Panel renders hardcoded placeholder text (e.g. `"00:00 focus —"`). Whole-window drag works. The panel does not steal focus from the underlying app.

The panel uses `styleMask = [.borderless, .nonactivatingPanel]`, `isFloatingPanel = true`, `level = .floating`, `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]`, `hidesOnDeactivate = false`, `isMovableByWindowBackground = true`.

**Feedback loop:** Manual: (1) launch menubar app, press `⌃⌥⌘P` → panel appears; press again → hides. (2) Enter fullscreen in another app (e.g. Safari fullscreen), press `⌃⌥⌘P` → panel appears over the fullscreen app on that Space. (3) Drag the panel — it moves and doesn't snap back.

**Human checkpoint:** yes

**Depends on:** hotkey-rewire

---

### `live-data` — Panel renders real timer state

**Status:** not-started

**Outside-in:** With a timer running (started via CLI or menubar), the panel shows live `MM:SS` ticking down, the correct phase label (`focus` / `break`), and the active project. With no timer (idle), the panel shows `--:--`, `idle`, and the last-used project. Pause freezes the displayed time; resume continues it. `AppDelegate` pushes each `Status` update into the controller alongside the existing icon/title refresh.

**Feedback loop:** Manual: start a focus block from CLI → panel shows ticking time, phase, project. Pause via menubar → time freezes. Resume → ticks again. Stop → panel returns to idle placeholder with last project preserved.

**Human checkpoint:** yes

**Depends on:** panel-skeleton, view-model

---

### `position-persistence` — Drag remembers per display across sessions

**Status:** not-started

**Outside-in:** Drag the panel to a new spot, hide via `⌃⌥⌘P`, show again — it reappears at that spot. Quit the menubar app, relaunch, summon — it reappears at the same spot. On a setup with two displays, drag on display A, hide, move focus to display B, summon — panel appears on B at B's last position (or B's default if never positioned). Move focus back to A, summon — panel appears at A's saved spot. If a previously-saved display is no longer connected, summon falls back to the active display's default position.

**Feedback loop:** Manual: drag, hide-show within session; drag, quit-relaunch; multi-display dance if available. Programmatically the slice integrates `FloatingTimerPosition` whose own tests cover the persistence layer.

**Human checkpoint:** yes

**Depends on:** panel-skeleton, position-store
