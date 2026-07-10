import AppKit
import XCTest

@MainActor
final class CapturePanelControllerTests: XCTestCase {
    func testShowCreatesBorderlessFloatingKeyablePanel() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        guard let panel = controller.panelForTesting else {
            XCTFail("Expected show() to create a panel")
            return
        }
        XCTAssertTrue(panel.isVisible)
        XCTAssertTrue(panel.styleMask.contains(.borderless))
        XCTAssertTrue(panel.isFloatingPanel)
        XCTAssertEqual(panel.level, .floating)
        XCTAssertTrue(panel.canBecomeKey)
        XCTAssertTrue(panel.collectionBehavior.contains(.canJoinAllSpaces))
        XCTAssertFalse(panel.isOpaque)
        XCTAssertEqual(panel.backgroundColor, .clear)
    }

    func testShowPresentsASingleTextField() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertNotNil(controller.textFieldForTesting)
    }

    func testReturnSubmitsTextAndDismisses() {
        var submitted: [String] = []
        let controller = CapturePanelController(onSubmit: { submitted.append($0) })
        controller.show()
        controller.textFieldForTesting?.stringValue = "remember to check the X bug"

        let handled = controller.sendCommandForTesting(#selector(NSResponder.insertNewline(_:)))

        XCTAssertTrue(handled)
        XCTAssertEqual(submitted, ["remember to check the X bug"])
        XCTAssertFalse(controller.panelForTesting?.isVisible ?? true)
    }

    func testEscapeDismissesWithoutSubmitting() {
        var submitted: [String] = []
        let controller = CapturePanelController(onSubmit: { submitted.append($0) })
        controller.show()
        controller.textFieldForTesting?.stringValue = "discard me"

        let handled = controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        XCTAssertTrue(handled)
        XCTAssertTrue(submitted.isEmpty)
        XCTAssertFalse(controller.panelForTesting?.isVisible ?? true)
    }

    func testResignKeyCancelsWithoutSubmitting() {
        var submitted: [String] = []
        let controller = CapturePanelController(onSubmit: { submitted.append($0) })
        controller.show()
        controller.textFieldForTesting?.stringValue = "discard me"

        controller.resignKeyForTesting()

        XCTAssertTrue(submitted.isEmpty)
        XCTAssertFalse(controller.panelForTesting?.isVisible ?? true)
    }

    func testShowClearsTextFromPreviousSession() {
        let controller = CapturePanelController(onSubmit: { _ in })
        controller.show()
        controller.textFieldForTesting?.stringValue = "leftover text"
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        controller.show()

        XCTAssertEqual(controller.textFieldForTesting?.stringValue, "")
    }

    func testToggleShowsThenHides() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.toggle()
        XCTAssertTrue(controller.panelForTesting?.isVisible ?? false)

        controller.toggle()
        XCTAssertFalse(controller.panelForTesting?.isVisible ?? true)
    }

    func testShowFadesPanelInFromTransparent() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertLessThan(controller.panelForTesting?.alphaValue ?? 1, 1)
    }

    func testShowWithZeroTransitionDurationIsImmediatelyOpaque() {
        let previous = CapturePanelController.showTransitionDuration
        CapturePanelController.showTransitionDuration = 0
        defer { CapturePanelController.showTransitionDuration = previous }
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertEqual(controller.panelForTesting?.alphaValue, 1)
    }

    func testPlaceholderNamesPmdr() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertEqual(controller.textFieldForTesting?.placeholderString, "Add a pmdr note…")
    }

    func testReturnSubmitsEmptyTextVerbatimForCliToNoOp() {
        var submitted: [String] = []
        let controller = CapturePanelController(onSubmit: { submitted.append($0) })
        controller.show()
        controller.textFieldForTesting?.stringValue = ""

        controller.sendCommandForTesting(#selector(NSResponder.insertNewline(_:)))

        XCTAssertEqual(submitted, [""])
    }
}
