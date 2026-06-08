import AppKit
import XCTest
import PmdrMenubarCore

@MainActor
final class FloatingTimerPanelControllerTests: XCTestCase {
    func testShowUsesSavedPositionForActiveDisplay() {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = FloatingTimerPosition(defaults: makeDefaults())
        store.record(NSPoint(x: 123, y: 456), for: screen)
        let controller = FloatingTimerPanelController(positionStore: store, screenProvider: { screen })

        controller.show()

        XCTAssertEqual(controller.panelForTesting?.frame.origin, NSPoint(x: 123, y: 456))
    }

    func testHideRecordsCurrentPositionForPanelDisplay() {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = FloatingTimerPosition(defaults: makeDefaults())
        let controller = FloatingTimerPanelController(positionStore: store, screenProvider: { screen })
        controller.show()
        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 333, y: 444))

        controller.hide()

        XCTAssertEqual(store.position(for: screen), NSPoint(x: 333, y: 444))
    }

    func testShowUsesPositionForCurrentActiveDisplay() {
        let left = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let right = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))
        var activeScreen: NSScreen? = left
        let store = FloatingTimerPosition(defaults: makeDefaults())
        store.record(NSPoint(x: 111, y: 222), for: left)
        store.record(NSPoint(x: 1555, y: 777), for: right)
        let controller = FloatingTimerPanelController(positionStore: store, screenProvider: { activeScreen })

        controller.show()
        XCTAssertEqual(controller.panelForTesting?.frame.origin, NSPoint(x: 111, y: 222))

        controller.hide()
        activeScreen = right
        controller.show()

        XCTAssertEqual(controller.panelForTesting?.frame.origin, NSPoint(x: 1555, y: 777))
    }

    func testShowFallsBackToDefaultPositionForActiveDisplayWithoutSavedPosition() {
        let left = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let right = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))
        let store = FloatingTimerPosition(defaults: makeDefaults())
        store.record(NSPoint(x: 111, y: 222), for: left)
        let controller = FloatingTimerPanelController(positionStore: store, screenProvider: { right })

        controller.show()

        let expected = store.defaultPosition(for: right, windowSize: FloatingTimerPanelController.defaultPanelSize)
        XCTAssertEqual(controller.panelForTesting?.frame.origin, expected)
    }

    func testToggleShowsAndHidesConfiguredFloatingPanel() {
        let controller = FloatingTimerPanelController()

        controller.toggle()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected toggle to create a panel")
            return
        }
        XCTAssertTrue(panel.isVisible)
        XCTAssertTrue(panel.styleMask.contains(.borderless))
        XCTAssertTrue(panel.styleMask.contains(.nonactivatingPanel))
        XCTAssertTrue(panel.isFloatingPanel)
        XCTAssertEqual(panel.level, .floating)
        XCTAssertTrue(panel.collectionBehavior.contains(.canJoinAllSpaces))
        XCTAssertTrue(panel.collectionBehavior.contains(.fullScreenAuxiliary))
        XCTAssertTrue(panel.collectionBehavior.contains(.stationary))
        XCTAssertFalse(panel.hidesOnDeactivate)
        XCTAssertTrue(panel.isMovableByWindowBackground)
        XCTAssertFalse(panel.isOpaque)
        XCTAssertEqual(panel.backgroundColor, .clear)

        let effect = controller.visualEffectViewForTesting
        XCTAssertNotNil(effect)
        XCTAssertEqual(effect?.material, .hudWindow)
        XCTAssertEqual(effect?.blendingMode, .behindWindow)
        XCTAssertEqual(effect?.state, .active)
        XCTAssertEqual(effect?.appearance?.name, NSAppearance.Name.vibrantDark)
        XCTAssertEqual(effect?.layer?.cornerRadius, 14)
        XCTAssertEqual(effect?.layer?.masksToBounds, true)

        controller.toggle()

        XCTAssertFalse(panel.isVisible)
    }

    func testUpdateRendersRunningTimerState() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.update(
            status: .running(active(remainingMs: 1_499_000, phase: .focus, project: "Deep Work", todayFocusBlocks: 2)),
            lastProject: "Admin",
            elapsedSincePoll: 0
        )

        let snapshot = controller.snapshotForTesting
        XCTAssertEqual(snapshot.time, "24:59")
        XCTAssertEqual(snapshot.phaseLabel, "FOCUS")
        XCTAssertEqual(snapshot.projectName, "Deep Work")
        XCTAssertEqual(snapshot.phaseColor, .systemRed)
        XCTAssertFalse(snapshot.isMuted)
        XCTAssertEqual(snapshot.completedFocusBlocks, 2)
    }

    func testUpdateRendersBreakInGreen() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.update(
            status: .running(active(remainingMs: 300_000, phase: .break, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 0
        )

        let snapshot = controller.snapshotForTesting
        XCTAssertEqual(snapshot.phaseLabel, "BREAK")
        XCTAssertEqual(snapshot.phaseColor, .systemGreen)
    }

    func testUpdateTicksRunningTimerButLeavesPausedTimerFrozen() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.update(
            status: .running(active(remainingMs: 10_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 3
        )
        XCTAssertEqual(controller.snapshotForTesting.time, "00:07")

        controller.update(
            status: .paused(active(remainingMs: 10_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 3
        )
        let paused = controller.snapshotForTesting
        XCTAssertEqual(paused.time, "00:10")
        XCTAssertEqual(paused.phaseColor, .secondaryLabelColor)
    }

    func testUpdateBeforeShowIsRenderedWhenPanelAppears() {
        let controller = FloatingTimerPanelController()

        controller.update(
            status: .idle,
            lastProject: "Writing",
            elapsedSincePoll: 0
        )
        controller.show()

        let snapshot = controller.snapshotForTesting
        XCTAssertEqual(snapshot.phaseLabel, "IDLE")
        XCTAssertEqual(snapshot.time, "--:--")
        XCTAssertEqual(snapshot.projectName, "Writing")
        XCTAssertTrue(snapshot.isMuted)
        XCTAssertEqual(snapshot.phaseColor, .secondaryLabelColor)
    }

    func testActionMethodsRouteToInjectedSink() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-02"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)

        controller.startTimer(project: "Deep Work")
        controller.pauseTimer()
        controller.resumeTimer()
        controller.stopTimer()
        controller.selectProject("Admin")
        controller.selectProject(nil)
        let projects = controller.availableProjects()

        XCTAssertEqual(sink.calls, [
            .start(project: "Deep Work"),
            .pause,
            .resume,
            .stop,
            .setProject("Admin"),
            .setProject(nil),
            .listProjects,
        ])
        XCTAssertEqual(projects.map(\.name), ["Deep Work", "Admin"])
    }

    func testAvailableProjectsReturnsEmptyWhenNoSinkInjected() {
        let controller = FloatingTimerPanelController()

        XCTAssertTrue(controller.availableProjects().isEmpty)
    }

    func testCloseButtonInvokesHide() {
        let controller = FloatingTimerPanelController()
        controller.show()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected show() to create a panel")
            return
        }
        XCTAssertTrue(panel.isVisible)

        guard let closeButton = controller.closeButtonForTesting,
              let target = closeButton.target,
              let action = closeButton.action
        else {
            XCTFail("Expected custom close button with target/action wired")
            return
        }
        _ = (target as AnyObject).perform(action, with: closeButton)

        XCTAssertFalse(panel.isVisible)
    }

    func testPanelFrameSizeMatchesDefaults() {
        let controller = FloatingTimerPanelController()

        controller.show()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected show() to create a panel")
            return
        }
        XCTAssertEqual(panel.frame.size, FloatingTimerPanelController.defaultPanelSize)
    }

    func testCloseButtonRoundTripsPerMonitorPosition() {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = FloatingTimerPosition(defaults: makeDefaults())
        let controller = FloatingTimerPanelController(positionStore: store, screenProvider: { screen })
        controller.show()
        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 222, y: 333))

        guard let closeButton = controller.closeButtonForTesting,
              let target = closeButton.target,
              let action = closeButton.action
        else {
            XCTFail("Expected custom close button target/action")
            return
        }
        _ = (target as AnyObject).perform(action, with: closeButton)

        XCTAssertEqual(store.position(for: screen), NSPoint(x: 222, y: 333))
    }

    func testCloseButtonIsHiddenWhenNotHoveredAndVisibleOnHover() {
        let controller = FloatingTimerPanelController()
        controller.show()

        XCTAssertEqual(controller.closeButtonAlphaForTesting, 0)
        XCTAssertEqual(controller.closeButtonForTesting?.isHidden, true)

        controller.setHoveredForTesting(true)
        XCTAssertEqual(controller.closeButtonAlphaForTesting, 1)
        XCTAssertEqual(controller.closeButtonForTesting?.isHidden, false)

        controller.setHoveredForTesting(false)
        XCTAssertEqual(controller.closeButtonAlphaForTesting, 0)
        XCTAssertEqual(controller.closeButtonForTesting?.isHidden, true)
    }

    func testHoverTrackingTogglesIsHovered() {
        let controller = FloatingTimerPanelController()
        controller.show()

        XCTAssertFalse(controller.isHovered)

        guard let trackingArea = controller.trackingAreaForTesting,
              let owner = trackingArea.owner as? NSView
        else {
            XCTFail("Expected a tracking area owned by a view")
            return
        }

        XCTAssertTrue(trackingArea.options.contains(.mouseEnteredAndExited))
        XCTAssertTrue(trackingArea.options.contains(.activeAlways))
        XCTAssertTrue(trackingArea.options.contains(.inVisibleRect))
        XCTAssertEqual(trackingArea.rect, owner.bounds)

        owner.mouseEntered(with: enterExitEvent(.mouseEntered))
        XCTAssertTrue(controller.isHovered)

        owner.mouseExited(with: enterExitEvent(.mouseExited))
        XCTAssertFalse(controller.isHovered)
    }

    func testDotsAreVisibleAndControlsHiddenWhenNotHovered() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.setHoveredForTesting(false)

        XCTAssertEqual(controller.dotsAlphaForTesting, 1)
        XCTAssertEqual(controller.controlsAlphaForTesting, 0)
        XCTAssertFalse(controller.areControlsVisibleForTesting)
    }

    func testControlsAreVisibleAndDotsHiddenWhenHovered() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.setHoveredForTesting(true)

        XCTAssertEqual(controller.dotsAlphaForTesting, 0)
        XCTAssertEqual(controller.controlsAlphaForTesting, 1)
        XCTAssertTrue(controller.areControlsVisibleForTesting)
    }

    func testToggleButtonStartsWhenIdle() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()
        controller.update(status: .idle, lastProject: "Writing", elapsedSincePoll: 0)

        XCTAssertEqual(controller.toggleButtonTitleForTesting, "Start")
        XCTAssertEqual(controller.toggleButtonSymbolNameForTesting, "play.fill")

        controller.clickToggleButtonForTesting()

        XCTAssertEqual(sink.calls, [.start(project: "Writing")])
    }

    func testToggleButtonPausesWhenRunningFocus() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()
        controller.update(
            status: .running(active(remainingMs: 60_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 0
        )

        XCTAssertEqual(controller.toggleButtonTitleForTesting, "Pause")
        XCTAssertEqual(controller.toggleButtonSymbolNameForTesting, "pause.fill")

        controller.clickToggleButtonForTesting()

        XCTAssertEqual(sink.calls, [.pause])
    }

    func testToggleButtonShowsSkipAndCallsPauseWhenRunningBreak() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()
        controller.update(
            status: .running(active(remainingMs: 60_000, phase: .break, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 0
        )

        XCTAssertEqual(controller.toggleButtonTitleForTesting, "Skip")
        XCTAssertEqual(controller.toggleButtonSymbolNameForTesting, "pause.fill")

        controller.clickToggleButtonForTesting()

        XCTAssertEqual(sink.calls, [.pause])
    }

    func testToggleButtonResumesWhenPaused() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()
        controller.update(
            status: .paused(active(remainingMs: 60_000, phase: .break, project: "Break")),
            lastProject: nil,
            elapsedSincePoll: 0
        )

        XCTAssertEqual(controller.toggleButtonTitleForTesting, "Resume")
        XCTAssertEqual(controller.toggleButtonSymbolNameForTesting, "play.fill")

        controller.clickToggleButtonForTesting()

        XCTAssertEqual(sink.calls, [.resume])
    }

    func testStopButtonEnabledStateFollowsStatusAndCallsStop() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()

        controller.update(status: .idle, lastProject: nil, elapsedSincePoll: 0)
        XCTAssertFalse(controller.isStopButtonEnabledForTesting)

        controller.update(
            status: .running(active(remainingMs: 60_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 0
        )
        XCTAssertTrue(controller.isStopButtonEnabledForTesting)
        controller.clickStopButtonForTesting()

        controller.update(
            status: .paused(active(remainingMs: 60_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 0
        )
        XCTAssertTrue(controller.isStopButtonEnabledForTesting)

        XCTAssertEqual(sink.calls, [.stop])
    }

    func testPanelFrameIsIdenticalAcrossHoverStates() {
        let controller = FloatingTimerPanelController()
        controller.show()
        let initialFrame = controller.panelForTesting?.frame

        controller.setHoveredForTesting(true)
        XCTAssertEqual(controller.panelForTesting?.frame, initialFrame)

        controller.setHoveredForTesting(false)
        XCTAssertEqual(controller.panelForTesting?.frame, initialFrame)
    }

    func testProjectLabelIsVisibleAndPopupHiddenWhenNotHovered() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.setHoveredForTesting(false)

        XCTAssertEqual(controller.projectLabelAlphaForTesting, 1)
        XCTAssertEqual(controller.projectPopupAlphaForTesting, 0)
        XCTAssertFalse(controller.isProjectPopupVisibleForTesting)
    }

    func testProjectPopupIsVisibleAndLabelHiddenWhenHovered() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.setHoveredForTesting(true)

        XCTAssertEqual(controller.projectLabelAlphaForTesting, 0)
        XCTAssertEqual(controller.projectPopupAlphaForTesting, 1)
        XCTAssertTrue(controller.isProjectPopupVisibleForTesting)
    }

    func testProjectPopupItemsFilterArchivedProjects() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Old Work", archived: true, createdAt: "2026-01-02"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-03"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)

        controller.show()

        XCTAssertEqual(controller.projectPopupItemTitlesForTesting, ["Deep Work", "Admin"])
        XCTAssertEqual(sink.calls, [.listProjects])
    }

    func testProjectPopupPreselectsCurrentActiveProject() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-02"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)
        controller.update(
            status: .running(active(remainingMs: 60_000, phase: .focus, project: "Admin")),
            lastProject: nil,
            elapsedSincePoll: 0
        )

        controller.show()

        XCTAssertEqual(controller.selectedProjectPopupTitleForTesting, "Admin")
    }

    func testProjectPopupPreselectsLastProjectWhenIdle() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-02"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)
        controller.update(status: .idle, lastProject: "Deep Work", elapsedSincePoll: 0)

        controller.show()

        XCTAssertEqual(controller.selectedProjectPopupTitleForTesting, "Deep Work")
    }

    func testSelectingProjectPopupItemInvokesSetProject() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-02"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()

        controller.selectProjectPopupItemForTesting(title: "Admin")

        XCTAssertEqual(sink.calls, [.setProject("Admin")])
    }

    func testStartUsesSelectedProjectPopupItemWhenIdle() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Writing", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-02"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)
        controller.update(status: .idle, lastProject: "Writing", elapsedSincePoll: 0)
        controller.show()
        controller.setHoveredForTesting(true)

        controller.selectProjectPopupItemForTesting(title: "Admin")
        sink.calls.removeAll()
        controller.clickToggleButtonForTesting()

        XCTAssertEqual(sink.calls, [.start(project: "Admin")])
    }

    func testProjectPopupRefreshesOnceWhenOpenedDuringHoverSession() {
        let sink = RecordingActionSink()
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
        ]
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
        sink.calls.removeAll()

        controller.setHoveredForTesting(true)
        sink.stubbedProjects = [
            ProjectRecord(name: "Deep Work", archived: false, createdAt: "2026-01-01"),
            ProjectRecord(name: "Admin", archived: false, createdAt: "2026-01-02"),
        ]

        controller.openProjectPopupForTesting()
        controller.openProjectPopupForTesting()

        XCTAssertEqual(controller.projectPopupItemTitlesForTesting, ["Deep Work", "Admin"])
        XCTAssertEqual(sink.calls, [.listProjects])

        controller.setHoveredForTesting(false)
        controller.setHoveredForTesting(true)
        sink.calls.removeAll()

        controller.openProjectPopupForTesting()

        XCTAssertEqual(sink.calls, [.listProjects])
    }

    func testPanelFrameIsIdenticalAcrossProjectPopupHoverStates() {
        let controller = FloatingTimerPanelController()
        controller.show()
        let initialFrame = controller.panelForTesting?.frame

        controller.setHoveredForTesting(true)
        XCTAssertEqual(controller.panelForTesting?.frame, initialFrame)

        controller.setHoveredForTesting(false)
        XCTAssertEqual(controller.panelForTesting?.frame, initialFrame)
    }

    private func enterExitEvent(_ type: NSEvent.EventType) -> NSEvent {
        NSEvent.enterExitEvent(
            with: type,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            eventNumber: 0,
            trackingNumber: 0,
            userData: nil
        )!
    }

    private func active(
        remainingMs: Int,
        phase: Phase,
        project: String?,
        completedFocusBlocks: Int = 0,
        todayFocusBlocks: Int = 0
    ) -> Status.Active {
        Status.Active(
            remainingMs: remainingMs,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: phase,
            completedFocusBlocks: completedFocusBlocks,
            todayFocusBlocks: todayFocusBlocks,
            project: project
        )
    }

    // MARK: - buildDotString

    func testBuildDotString_goal8_cadence4_allEmpty() {
        let result = FloatingTimerPanelController.buildDotString(completed: 0, goal: 8, longBreakEvery: 4)
        // thin space (U+2009) between dots within a group; two regular spaces between groups
        XCTAssertEqual(result, "○\u{2009}○\u{2009}○\u{2009}○  ○\u{2009}○\u{2009}○\u{2009}○")
    }

    func testBuildDotString_goal8_cadence4_partialFilled() {
        // completed=3: positions 0,1,2 filled; position 3 empty; gap before second group
        let result = FloatingTimerPanelController.buildDotString(completed: 3, goal: 8, longBreakEvery: 4)
        XCTAssertEqual(result, "●\u{2009}●\u{2009}●\u{2009}○  ○\u{2009}○\u{2009}○\u{2009}○")
    }

    func testBuildDotString_goal8_cadence4_groupBoundaryFilled() {
        // completed=4: first group all filled; second group all empty
        let result = FloatingTimerPanelController.buildDotString(completed: 4, goal: 8, longBreakEvery: 4)
        XCTAssertEqual(result, "●\u{2009}●\u{2009}●\u{2009}●  ○\u{2009}○\u{2009}○\u{2009}○")
    }

    func testBuildDotString_goal6_cadence2() {
        // completed=2: first group (0,1) filled; gap; second group empty; gap; third group empty
        let result = FloatingTimerPanelController.buildDotString(completed: 2, goal: 6, longBreakEvery: 2)
        XCTAssertEqual(result, "●\u{2009}●  ○\u{2009}○  ○\u{2009}○")
    }

    func testBuildDotString_goal10_cadence4_nonDivisible() {
        // completed=5: positions 0-3 filled, position 4 filled (boundary), 5-7 empty, position 8 boundary, 9 empty
        let result = FloatingTimerPanelController.buildDotString(completed: 5, goal: 10, longBreakEvery: 4)
        XCTAssertEqual(result, "●\u{2009}●\u{2009}●\u{2009}●  ●\u{2009}○\u{2009}○\u{2009}○  ○\u{2009}○")
    }

    func testBuildDotString_completedCappedAtGoal() {
        // completed=12 capped to goal=8: all filled
        let result = FloatingTimerPanelController.buildDotString(completed: 12, goal: 8, longBreakEvery: 4)
        XCTAssertEqual(result, "●\u{2009}●\u{2009}●\u{2009}●  ●\u{2009}●\u{2009}●\u{2009}●")
    }

    func testPanelUsesConfigDailyGoalForDots() {
        let controller = FloatingTimerPanelController()
        controller.show()
        controller.configureGoal(dailyGoal: 6, longBreakEvery: 2)

        controller.update(
            status: .running(active(remainingMs: 60_000, phase: .focus, project: "Work", todayFocusBlocks: 2)),
            lastProject: nil,
            elapsedSincePoll: 0
        )

        XCTAssertEqual(controller.dotStringForTesting, "●\u{2009}●  ○\u{2009}○  ○\u{2009}○")
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "FloatingTimerPanelControllerTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}

@MainActor
private final class RecordingActionSink: FloatingTimerActions {
    enum Call: Equatable {
        case start(project: String?)
        case pause
        case resume
        case stop
        case setProject(String?)
        case listProjects
    }

    var calls: [Call] = []
    var stubbedProjects: [ProjectRecord] = []

    func start(project: String?) { calls.append(.start(project: project)) }
    func pause() { calls.append(.pause) }
    func resume() { calls.append(.resume) }
    func stop() { calls.append(.stop) }
    func setProject(_ project: String?) { calls.append(.setProject(project)) }
    func listProjects() -> [ProjectRecord] {
        calls.append(.listProjects)
        return stubbedProjects
    }
}

private final class TestScreen: NSScreen {
    private let testDisplayID: CGDirectDisplayID
    private let testFrame: NSRect

    init(displayID: CGDirectDisplayID, frame: NSRect) {
        self.testDisplayID = displayID
        self.testFrame = frame
        super.init()
    }

    override var frame: NSRect {
        testFrame
    }

    override var visibleFrame: NSRect {
        testFrame
    }

    override var deviceDescription: [NSDeviceDescriptionKey: Any] {
        [NSDeviceDescriptionKey("NSScreenNumber"): NSNumber(value: testDisplayID)]
    }
}
