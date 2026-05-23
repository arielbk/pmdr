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

        let expected = store.defaultPosition(for: right, windowSize: controller.panelForTesting!.frame.size)
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
        XCTAssertEqual((panel.contentView as? NSTextField)?.stringValue, "00:00 focus -")

        controller.toggle()

        XCTAssertFalse(panel.isVisible)
    }

    func testUpdateRendersRunningTimerState() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.update(
            status: .running(active(remainingMs: 1_499_000, phase: .focus, project: "Deep Work")),
            lastProject: "Admin",
            elapsedSincePoll: 0
        )

        XCTAssertEqual((controller.panelForTesting?.contentView as? NSTextField)?.stringValue, "24:59 focus Deep Work")
    }

    func testUpdateTicksRunningTimerButLeavesPausedTimerFrozen() {
        let controller = FloatingTimerPanelController()
        controller.show()

        controller.update(
            status: .running(active(remainingMs: 10_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 3
        )
        XCTAssertEqual((controller.panelForTesting?.contentView as? NSTextField)?.stringValue, "00:07 focus Deep Work")

        controller.update(
            status: .paused(active(remainingMs: 10_000, phase: .focus, project: "Deep Work")),
            lastProject: nil,
            elapsedSincePoll: 3
        )
        XCTAssertEqual((controller.panelForTesting?.contentView as? NSTextField)?.stringValue, "00:10 focus Deep Work")
    }

    func testUpdateBeforeShowIsRenderedWhenPanelAppears() {
        let controller = FloatingTimerPanelController()

        controller.update(
            status: .idle,
            lastProject: "Writing",
            elapsedSincePoll: 0
        )
        controller.show()

        let label = controller.panelForTesting?.contentView as? NSTextField
        XCTAssertEqual(label?.stringValue, "--:-- idle Writing")
        XCTAssertEqual(label?.textColor, .secondaryLabelColor)
    }

    private func active(
        remainingMs: Int,
        phase: Phase,
        project: String?
    ) -> Status.Active {
        Status.Active(
            remainingMs: remainingMs,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: phase,
            completedFocusBlocks: 0,
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
