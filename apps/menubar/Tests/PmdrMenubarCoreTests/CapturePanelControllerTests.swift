import AppKit
import PmdrMenubarCore
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

    func testShowPresentsTheSharedDarkOverlaySurface() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        let surface = OverlaySurface.standard
        guard let panel = controller.panelForTesting,
              let surfaceView = controller.surfaceViewForTesting
        else {
            XCTFail("Expected show() to present an overlay surface")
            return
        }
        XCTAssertFalse(
            surfaceView is NSVisualEffectView,
            "capture must not derive its legibility from window vibrancy"
        )
        XCTAssertEqual(surfaceView.layer?.backgroundColor, surface.backgroundColor.cgColor)
        XCTAssertEqual(surfaceView.layer?.borderColor, surface.borderColor.cgColor)
        XCTAssertEqual(surfaceView.layer?.borderWidth, surface.borderWidth)
        XCTAssertEqual(surfaceView.layer?.cornerRadius, surface.cornerRadius)
        XCTAssertEqual(surfaceView.layer?.masksToBounds, true)
        XCTAssertEqual(surfaceView.effectiveAppearance.name, surface.appearanceName)
        XCTAssertTrue(panel.hasShadow)
        XCTAssertEqual(panel.frame.size, surface.panelSize(forVisualSize: surfaceView.frame.size))
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

    func testShowFocusesAnEmptyInput() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        guard let panel = controller.panelForTesting,
              let field = controller.textFieldForTesting
        else {
            XCTFail("Expected show() to present an input")
            return
        }
        XCTAssertEqual(field.stringValue, "")
        let responder = panel.firstResponder
        XCTAssertTrue(
            responder === field || (responder as? NSTextView)?.delegate === field,
            "typing should land in the capture field without a click"
        )
    }

    func testShowLeadsWithTheBrandMark() {
        let mark = NSImage(size: NSSize(width: 18, height: 20))
        let controller = CapturePanelController(onSubmit: { _ in }, iconProvider: { mark })

        controller.show()

        guard let icon = controller.iconViewForTesting,
              let surfaceView = controller.surfaceViewForTesting
        else {
            XCTFail("Expected show() to present a brand mark")
            return
        }
        surfaceView.layoutSubtreeIfNeeded()
        XCTAssertEqual(icon.image, mark, "the row should identify itself as pmdr")
        XCTAssertTrue(icon.isDescendant(of: surfaceView))
        XCTAssertGreaterThan(icon.frame.width, 0)
        XCTAssertLessThan(
            icon.frame.minX,
            controller.textFieldForTesting?.frame.minX ?? 0,
            "the mark leads the input"
        )
    }

    /// The default provider reads the app's asset catalog, which is only reachable
    /// when the tests run inside the app host (`xcodebuild test`), not under the
    /// bare `xctest` harness `scripts/menubar-test.sh` uses.
    func testDefaultBrandMarkComesFromTheBundledTomatoAsset() throws {
        try XCTSkipIf(
            BrandIcon.templateImage(.filled) == nil,
            "asset catalog unreachable from this test host"
        )
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertNotNil(controller.iconViewForTesting?.image)
    }

    func testCaptureRowIsACompactFixedWidthSurface() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertEqual(controller.surfaceViewForTesting?.frame.width, 480)
        XCTAssertEqual(
            controller.panelForTesting?.frame.width,
            OverlaySurface.standard.panelSize(forVisualSize: NSSize(width: 480, height: 46)).width
        )
    }

    func testHistoryControlShowsTodaysNoteCount() async {
        let notes = [
            NoteRecord(text: "one", at: 1_700_000_000_000),
            NoteRecord(text: "two", at: 1_700_000_060_000),
            NoteRecord(text: "three", at: 1_700_000_120_000),
        ]
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { notes })

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(controller.historyControlForTesting?.title, "Today · 3")
    }

    func testHistoryControlReportsAnUnavailableCountWhenTheCliCannotBeRead() async {
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { nil })

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(controller.historyControlForTesting?.title, "Today · —")
        XCTAssertEqual(controller.historyControlForTesting?.isEnabled, false)
    }

    func testHistoryControlShowsZeroWhenNoNotesWereCapturedToday() async {
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { [] })

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(controller.historyControlForTesting?.title, "Today · 0")
        XCTAssertEqual(controller.historyControlForTesting?.isEnabled, true)
    }

    func testHistoryCountIsRefreshedOnEveryInvocation() async {
        var stored = [NoteRecord(text: "one", at: 1_700_000_000_000)]
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { stored })
        controller.show()
        await controller.historyLoadForTesting?.value
        XCTAssertEqual(controller.historyControlForTesting?.title, "Today · 1")
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        stored.append(NoteRecord(text: "two", at: 1_700_000_060_000))
        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(controller.historyControlForTesting?.title, "Today · 2")
    }

    func testHistoryStartsCollapsedOnEveryInvocation() async {
        let controller = CapturePanelController(
            onSubmit: { _ in },
            notesProvider: { [NoteRecord(text: "one", at: 1_700_000_000_000)] }
        )
        controller.show()
        await controller.historyLoadForTesting?.value
        XCTAssertFalse(controller.isHistoryExpandedForTesting)

        controller.historyControlForTesting?.performClick(nil)
        XCTAssertTrue(controller.isHistoryExpandedForTesting)
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        controller.show()

        XCTAssertFalse(controller.isHistoryExpandedForTesting)
    }

    func testActivatingHistoryKeepsThePanelUpAndTypingFocused() async {
        var submitted: [String] = []
        let controller = CapturePanelController(
            onSubmit: { submitted.append($0) },
            notesProvider: { [NoteRecord(text: "one", at: 1_700_000_000_000)] }
        )
        controller.show()
        await controller.historyLoadForTesting?.value
        controller.textFieldForTesting?.stringValue = "half-typed"

        controller.historyControlForTesting?.performClick(nil)

        guard let panel = controller.panelForTesting,
              let field = controller.textFieldForTesting
        else {
            XCTFail("Expected a visible panel")
            return
        }
        XCTAssertTrue(panel.isVisible)
        XCTAssertEqual(field.stringValue, "half-typed")
        let responder = panel.firstResponder
        XCTAssertTrue(
            responder === field || (responder as? NSTextView)?.delegate === field,
            "the history control must not steal the caret"
        )
        XCTAssertTrue(submitted.isEmpty)
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
