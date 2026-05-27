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

    func testPanelChromeUsesTitledClosableAndFullSizeContentView() {
        let controller = FloatingTimerPanelController()

        controller.show()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected show() to create a panel")
            return
        }
        XCTAssertTrue(panel.styleMask.contains(.titled))
        XCTAssertTrue(panel.styleMask.contains(.closable))
        XCTAssertTrue(panel.styleMask.contains(.fullSizeContentView))
        XCTAssertTrue(panel.styleMask.contains(.nonactivatingPanel))
        XCTAssertEqual(panel.titleVisibility, .hidden)
        XCTAssertTrue(panel.titlebarAppearsTransparent)
    }

    func testMiniaturizeAndZoomButtonsAreHidden() {
        let controller = FloatingTimerPanelController()

        controller.show()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected show() to create a panel")
            return
        }
        // Buttons are either nil (absent from styleMask) or explicitly hidden.
        if let miniaturize = panel.standardWindowButton(.miniaturizeButton) {
            XCTAssertTrue(miniaturize.isHidden)
        }
        if let zoom = panel.standardWindowButton(.zoomButton) {
            XCTAssertTrue(zoom.isHidden)
        }
    }

    func testCloseButtonTargetActionInvokesHide() {
        let controller = FloatingTimerPanelController()
        controller.show()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected show() to create a panel")
            return
        }
        XCTAssertTrue(panel.isVisible)

        guard let closeButton = panel.standardWindowButton(.closeButton) else {
            XCTFail("Expected a standard close button")
            return
        }
        XCTAssertFalse(closeButton.isHidden)
        guard let target = closeButton.target, let action = closeButton.action else {
            XCTFail("Expected close button to have target/action wired")
            return
        }
        _ = (target as AnyObject).perform(action, with: closeButton)

        XCTAssertFalse(panel.isVisible)
    }

    func testPanelFrameSizeIsUnchangedByTitledChrome() {
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

        guard let closeButton = controller.panelForTesting?.standardWindowButton(.closeButton),
              let target = closeButton.target,
              let action = closeButton.action
        else {
            XCTFail("Expected close button target/action")
            return
        }
        _ = (target as AnyObject).perform(action, with: closeButton)

        XCTAssertEqual(store.position(for: screen), NSPoint(x: 222, y: 333))
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
        controller.update(status: .idle, lastProject: "Writing", elapsedSincePoll: 0)

        XCTAssertEqual(controller.toggleButtonTitleForTesting, "Start")
        XCTAssertEqual(controller.toggleButtonSymbolNameForTesting, "play.fill")

        controller.clickToggleButtonForTesting()

        XCTAssertEqual(sink.calls, [.start(project: "Writing")])
    }

    func testToggleButtonPausesWhenRunning() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
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

    func testToggleButtonResumesWhenPaused() {
        let sink = RecordingActionSink()
        let controller = FloatingTimerPanelController(actions: sink)
        controller.show()
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
