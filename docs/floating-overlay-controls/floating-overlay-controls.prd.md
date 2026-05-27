# PRD: Floating overlay controls

## Problem Statement

The macOS floating timer overlay is keyboard-only. When the user's hands are occupied (the canonical example: holding a baby), they can't dismiss the overlay or change timer state without getting to the keyboard. The overlay also has no way to switch projects or start/pause/stop the timer in place — every interaction round-trips through the menubar menu.

## Solution

Add two pieces of mouse-driven control to the existing floating panel:

1. A real macOS close button (traffic-light style) in the panel chrome, always visible, that hides the overlay.
2. Hover-revealed controls — a play/pause toggle, a stop button, and a project popup — that crossfade into the existing project-name and dots positions when the cursor enters the panel, and fade out when it leaves. No layout shift, no added vertical space.

## User Stories

1. As a user with my hands full, I want to click a visible close button on the overlay so that I can dismiss it without reaching for the keyboard.
2. As a user, I want the close button to look like a native macOS window control so the overlay feels like a first-class app surface rather than a custom widget.
3. As a user, I want the overlay to stay the same size and shape as today when idle, so that nothing about its quiet state changes.
4. As a user, I want controls to appear when I hover the overlay, so that the resting state stays minimal and uncluttered.
5. As a user, I want to start the timer from the overlay when idle, so I don't need to open the menubar menu.
6. As a user with a running timer, I want to pause it from the overlay, so I can step away quickly.
7. As a user with a paused timer, I want to resume it from the overlay, using the same button position that paused it.
8. As a user, I want to stop the timer from the overlay regardless of running/paused state.
9. As a user, I want to switch the active project from the overlay via a popup, so I don't need to open the menubar menu to change context.
10. As a user, I want the controls to crossfade in and out smoothly on hover, so the transition doesn't feel jarring.
11. As a user, I want the controls to occupy the same slots as the dots and project name, so that hovering never makes the panel grow or shift.

## Implementation Decisions

### Panel chrome — close button

- Change the floating panel's `styleMask` from `[.borderless, .nonactivatingPanel]` to `[.titled, .fullSizeContentView, .nonactivatingPanel, .closable]`.
- `titlebarAppearsTransparent = true`, `titleVisibility = .hidden`, `movableByWindowBackground = true`.
- Hide `miniaturizeButton` and `zoomButton`; keep `closeButton`.
- Wire the close button's action to the existing `hide()` path so it behaves identically to the toggle hotkey (does not stop the running timer).
- The current `shadowMargin = 20` inset trick that produces a custom rounded shadow on the borderless panel comes out. With `.titled` + `.fullSizeContentView`, the system handles corners and shadow. Re-test that content draws edge-to-edge and that the per-monitor position persistence still works after the styleMask change.

### Hover-revealed controls

- The current vertical stack (PHASE / project / time / dots) keeps its slots. Hover swaps two of them:
  - **project label slot** ↔ `NSPopUpButton` listing projects, current project preselected.
  - **dots slot** ↔ a horizontal `NSStackView` containing `[play/pause toggle button] [stop button]`.
- PHASE and time labels never change on hover.
- Hover detection: an `NSTrackingArea` on the visual-effect view, `.mouseEnteredAndExited | .activeAlways | .inVisibleRect`. Mouse-entered triggers a short crossfade (~120ms) to controls; mouse-exited reverses it.
- Layout never shifts: the controls views sit in the exact frame the swapped labels occupied. Two strategies are acceptable; pick whichever is cleaner during build:
  - Pre-build both label and control views in the same superview, animate `alphaValue` in opposite directions.
  - Use a container view per slot with the label and control as alternating subviews, animating `isHidden` via a crossfade.

### State-to-control mapping

The play/pause toggle's behavior depends on the current `Status`:

| Status         | Toggle button shows | Toggle action     | Stop enabled |
| -------------- | ------------------- | ----------------- | ------------ |
| IDLE           | ▶ Start             | `start(project:)` | no           |
| focus running  | ⏸ Pause             | `pause()`         | yes          |
| break running  | ⏸ Pause             | `pause()`         | yes          |
| focus paused   | ▶ Resume            | `resume()`        | yes          |
| break paused   | ▶ Resume            | `resume()`        | yes          |

Stop calls `stop()`. Start uses the currently selected project in the popup (which mirrors the active project, or last project, when idle).

### Project popup

- Populated from `PmdrClient.listProjects(includeArchived: false)`. The same list the menubar `changeProjectItem` builds from.
- Selecting a project calls `PmdrClient.setProject(_:)` (or `start(project:)` if the timer is idle and the user clicks the play button afterward).
- The popup must repopulate when the project list changes. Reuse whatever refresh signal the menubar already uses for its project picker; if there isn't one, refresh on panel show and when the popup is first opened during a hover.

### Controller surface

- All changes are contained in `FloatingTimerPanelController`. It already owns the panel and receives `update(status:lastProject:elapsedSincePoll:)` ticks — extend its snapshot/render path to drive control state from `Status`.
- Wire user actions on the controls back through the existing `PmdrClient` the menubar already holds. The cleanest interface is to inject a small action sink (closure-based or a protocol) into `FloatingTimerPanelController` so that `AppDelegate` (which owns the `PmdrClient`) handles the actual command execution, keeping the controller free of CLI knowledge.

## Testing Decisions

- **Unit (host-test, AppKit)**: extend `FloatingTimerPanelControllerTests` to cover:
  - Close-button presence; clicking it invokes `hide()` and does not stop the timer.
  - Hover entry/exit swaps which views are visible without changing panel frame.
  - Toggle button label/symbol and action selection follows the state table above for each `Status` case.
  - Stop button is disabled in IDLE, enabled in running and paused.
  - Project popup is populated from injected project list and reflects the active project as the selection.
- **Action wiring**: inject a test double for the action sink and assert that clicking each control fires the expected call (start/pause/resume/stop/setProject).
- Prior art: `FloatingTimerPanelControllerTests` and `FloatingTimerViewModelTests` already host the panel in tests and inspect snapshot state. Follow that pattern; do not introduce UI-snapshot or screenshot testing.

## Out of Scope

- Any change to the menubar menu itself.
- A custom × button or any non-traffic-light close UI.
- Always-visible controls; controls outside the existing label slots; any layout that adds vertical chrome.
- Project management beyond switching (creating, renaming, archiving projects from the overlay).
- Minimize and zoom buttons.
- Showing additional information on hover (e.g. recent projects, stats).
- Keyboard shortcut changes — the existing toggle hotkey continues to work alongside the new close button.

## Open Questions

- Does the menubar already broadcast a "projects changed" signal that the overlay can subscribe to, or should the overlay refresh its popup list lazily on hover? Decide during implementation by reading the menubar's existing wiring.
