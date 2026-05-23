import AppKit
import XCTest
import PmdrMenubarCore

@MainActor
final class FloatingTimerPanelControllerTests: XCTestCase {
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
}
