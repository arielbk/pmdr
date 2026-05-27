# QA Plan: Floating overlay controls

## What was built

The floating timer overlay now has native close chrome plus hover-revealed controls for start/pause/resume, stop, and project selection. The controls are wired through an injected action sink so the panel can drive the existing timer client without keyboard shortcuts.

## Already verified by the agent

These were run during implementation and passed. Listed for confidence, not action.

- [x] `cd apps/menubar && xcodebuild build-for-testing -scheme pmdr-menubar -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO && xcrun xctest DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` — controls-row host feedback loop passed: 98 tests executed, 3 expected integration skips, 0 failures.
- [x] `cd apps/menubar && xcodebuild build-for-testing -scheme pmdr-menubar -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO && xcrun xctest DerivedData/Build/Products/Debug/pmdr-menubarTests.xctest` — project-popup host feedback loop passed: 107 tests executed, 3 expected integration skips, 0 failures.

## Human verification required

Items from slices with `Human checkpoint: yes`, plus anything from the log that needs a human eye, browser, device, or judgement call.

- [ ] Native close button: open the menubar app and verify the close traffic-light is visible in the expected top-left position, looks like native macOS chrome, and clicking it hides the floating panel.
- [ ] Native close button layout: verify the floating overlay content still draws edge-to-edge with no title-bar gap, no extra vertical space, and no awkward offset caused by the panel's shadow margin.
- [ ] Native close button behavior: after closing the panel with the traffic-light, verify the existing hotkey/menu toggle can show it again and per-monitor position persistence still feels correct.
- [ ] Controls row: hover the floating panel and verify the dots slot changes to the play/pause toggle plus stop button without layout shift.
- [ ] Controls row visual feel: verify the hover transition is smooth enough and the controls feel minimal rather than busy; decide whether the deterministic alpha swap needs the 120ms animation mentioned in the log.

## Watch closely

Items where the log recorded deviations, snags, or unusual decisions. These are the most likely sources of subtle bugs — worth extra scrutiny during human verification.

- [ ] `action-sink`: the first iteration could not run Swift/AppKit tests in its sandbox and initially flagged possible `@MainActor` conformance risk; later host test runs passed after actor isolation was adjusted.
- [ ] `hover-tracking`: the log called out an `NSTrackingArea.rect` runtime assumption with `.inVisibleRect`; host tests later passed, but hover enter/exit behavior is still worth checking while exercising the UI.
- [ ] `native-close-button`: the log noted a known visual risk that the standard close button may sit in the 20pt shadow-margin band, above/left of the visible rounded rectangle.
- [ ] `controls-row`: the implementation uses deterministic alpha/hidden state updates instead of timed `NSAnimationContext`; visual QA should decide whether that is acceptable.
- [ ] `controls-row`: protocol-wide `@MainActor` isolation was removed from `FloatingTimerActions` and matching `AppDelegate` methods because it made `main.swift` fail to compile; confirm controls still act on the expected main UI path during manual use.
- [ ] `project-popup`: the popup follows the same deterministic alpha/hidden transition pattern as controls-row, filters archived projects defensively, and refreshes on panel show plus once per hover-session menu open.
- [ ] `project-popup`: existing controls-row action tests were adjusted to clear the setup-time `listProjects` call after `show()` because the popup intentionally refreshes projects whenever the panel is shown.
