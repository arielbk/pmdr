# Floating overlay controls

Adds a native macOS close button and hover-revealed controls (play/pause toggle, stop, project popup) to the floating timer overlay, so the user can drive the timer and switch projects without a keyboard.

## Slices

### `action-sink` — Inject an action sink into the panel controller

**Status:** needs-review

**Outside-in:** `FloatingTimerPanelController` accepts an `actions` parameter (closure-set or small protocol) exposing `start(project:)`, `pause()`, `resume()`, `stop()`, `setProject(_:)`, `listProjects()`. `AppDelegate` injects an implementation backed by the existing `PmdrClient`.

**Feedback loop:** Host-test: construct the controller with a test-double action sink, invoke each action method directly on the controller's test surface, assert the sink records the call.

**Human checkpoint:** no

**Depends on:** none

---

### `native-close-button` — Replace borderless chrome with transparent-titlebar + close button

**Status:** not-started

**Outside-in:** The floating panel shows a real macOS close traffic-light in the top-left corner. Clicking it calls the same `hide()` path as the toggle hotkey. No miniaturize/zoom buttons. Panel visual size unchanged; no extra vertical space added.

**Feedback loop:** Host-test: panel's `styleMask` contains `.titled`, `.closable`, `.fullSizeContentView`; miniaturize and zoom buttons are hidden; close button target/action invokes `hide()`; per-monitor position persistence still round-trips correctly after the styleMask change.

**Human checkpoint:** yes — eyeball that the close button matches native chrome and that content still draws edge-to-edge with no title-bar gap.

**Depends on:** none

---

### `hover-tracking` — Add hover state to the panel

**Status:** not-started

**Outside-in:** `FloatingTimerPanelController` exposes an observable `isHovered` flag driven by an `NSTrackingArea` on the visual-effect view (`.mouseEnteredAndExited | .activeAlways | .inVisibleRect`).

**Feedback loop:** Host-test: simulate `mouseEntered`/`mouseExited` on the tracking area's owner; assert `isHovered` toggles accordingly and that the tracking area's rect matches the visual content frame.

**Human checkpoint:** no

**Depends on:** none

---

### `controls-row` — Crossfade play/pause + stop into the dots slot on hover

**Status:** not-started

**Outside-in:** On hover, the dots row crossfades to a horizontal row containing a play/pause toggle button and a stop button. Toggle button's symbol/action follows the state-to-control table in the PRD (Start when IDLE, Pause when running, Resume when paused). Stop is disabled in IDLE. Clicks invoke the corresponding action-sink method. No layout shift.

**Feedback loop:** Host-tests covering: (a) dots visible / controls hidden when `isHovered = false`; (b) controls visible / dots hidden when `isHovered = true`; (c) for each `Status` case, toggle button shows the right label/symbol and clicking it calls the expected action; (d) stop button enabled-state follows the table; (e) panel frame is identical in both hover states.

**Human checkpoint:** yes — eyeball the crossfade smoothness and that the controls feel "minimal" rather than busy.

**Depends on:** action-sink, hover-tracking

---

### `project-popup` — Crossfade an NSPopUpButton into the project-label slot on hover

**Status:** not-started

**Outside-in:** On hover, the project name label crossfades to an `NSPopUpButton` populated from `listProjects()` (active project preselected). Selecting an item calls `setProject(_:)` via the action sink. List refreshes on panel show; refresh again the first time the popup is opened during a hover session.

**Feedback loop:** Host-tests covering: (a) label visible / popup hidden when `isHovered = false` and vice versa; (b) popup items match the injected project list with archived projects filtered out; (c) preselected item equals the current active project (or last project when idle); (d) selecting an item invokes `setProject(_:)` with the chosen name; (e) panel frame is identical in both hover states.

**Human checkpoint:** no

**Depends on:** action-sink, hover-tracking
