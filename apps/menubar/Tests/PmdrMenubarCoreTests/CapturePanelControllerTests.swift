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
        XCTAssertEqual(surfaceView.material, surface.material)
        XCTAssertEqual(surfaceView.blendingMode, surface.blendingMode)
        XCTAssertEqual(surfaceView.state, surface.effectState)
        XCTAssertTrue(surfaceView.isEmphasized)
        let tintView = surfaceView.subviews.first {
            $0.identifier == OverlaySurface.tintViewIdentifier
        }
        XCTAssertEqual(tintView?.layer?.backgroundColor, surface.tintColor.cgColor)
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

    // MARK: - Daily note history

    func testCollapsedPanelShowsNoHistoryRows() async {
        let controller = CapturePanelController(
            onSubmit: { _ in },
            notesProvider: { [NoteRecord(text: "one", at: 1_700_000_000_000)] }
        )

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(controller.historyViewForTesting?.isHidden, true)
        XCTAssertTrue(controller.historyRowsForTesting.isEmpty)
    }

    func testActivatingHistoryRevealsARowPerNote() async {
        let controller = CapturePanelController(
            onSubmit: { _ in },
            notesProvider: {
                [
                    NoteRecord(text: "one", at: 1_700_000_000_000),
                    NoteRecord(text: "two", at: 1_700_000_060_000),
                ]
            }
        )
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        XCTAssertEqual(controller.historyViewForTesting?.isHidden, false)
        XCTAssertEqual(controller.historyRowsForTesting.count, 2)
    }

    func testHistoryShowsNewestNoteFirstWithItsCaptureTime() async {
        let controller = CapturePanelController(
            onSubmit: { _ in },
            notesProvider: {
                // The CLI hands notes back ascending by capture time.
                [
                    NoteRecord(text: "earliest", at: 1_700_000_000_000),
                    NoteRecord(text: "middle", at: 1_700_000_060_000),
                    NoteRecord(text: "latest", at: 1_700_000_120_000),
                ]
            },
            timeFormatter: { date in "T\(Int(date.timeIntervalSince1970))" }
        )
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        let rows = controller.historyRowsForTesting
        XCTAssertEqual(rows.map(\.textLabel.stringValue), ["latest", "middle", "earliest"])
        XCTAssertEqual(rows.map(\.timeLabel.stringValue), ["T1700000120", "T1700000060", "T1700000000"])
        XCTAssertEqual(
            rows.map(\.frame.minY).sorted(), rows.map(\.frame.minY),
            "rows stack top-down in the order they are listed"
        )
    }

    func testHistorySaysSoWhenNoNotesWereCapturedToday() async {
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { [] })
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        XCTAssertTrue(controller.historyRowsForTesting.isEmpty)
        XCTAssertEqual(controller.historyPlaceholderForTesting?.stringValue, "No notes yet")
    }

    func testHistoryDistinguishesUnreadableNotesFromAnEmptyDay() async {
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { nil })
        controller.show()
        await controller.historyLoadForTesting?.value

        // The disabled control cannot be clicked into an expanded state by the
        // user, so drive the same toggle the control would.
        controller.historyControlForTesting?.isEnabled = true
        controller.historyControlForTesting?.performClick(nil)

        XCTAssertTrue(controller.historyRowsForTesting.isEmpty)
        XCTAssertEqual(controller.historyPlaceholderForTesting?.stringValue, "Notes unavailable")
    }

    func testALongNoteIsClampedToTwoLines() async {
        let long = String(repeating: "a scannable fragment of a very long note ", count: 12)
        let controller = CapturePanelController(
            onSubmit: { _ in },
            notesProvider: {
                [
                    NoteRecord(text: "short", at: 1_700_000_000_000),
                    NoteRecord(text: long, at: 1_700_000_060_000),
                ]
            }
        )
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        guard let longRow = controller.historyRowsForTesting.first,
              let shortRow = controller.historyRowsForTesting.last
        else {
            XCTFail("Expected two history rows")
            return
        }
        XCTAssertEqual(longRow.textLabel.maximumNumberOfLines, 2)
        XCTAssertEqual(longRow.textLabel.lineBreakMode, .byTruncatingTail)
        XCTAssertGreaterThan(
            longRow.frame.height, shortRow.frame.height,
            "a long note should use its second line"
        )
        XCTAssertLessThan(
            longRow.frame.height, shortRow.frame.height * 2.5,
            "one note must not dominate the history"
        )
    }

    func testManyNotesCapTheHistoryHeightAndScroll() async {
        let notes = (0..<40).map { NoteRecord(text: "note \($0)", at: 1_700_000_000_000 + $0 * 60_000) }
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { notes })
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        guard let historyView = controller.historyViewForTesting else {
            XCTFail("Expected a history list")
            return
        }
        XCTAssertEqual(historyView.frame.height, NoteHistoryListView.maximumHeight)
        XCTAssertTrue(historyView.isScrollable, "capped history must scroll to the rest of the day")
        XCTAssertTrue(historyView.hasVerticalScroller)
        XCTAssertEqual(controller.historyRowsForTesting.count, 40)
    }

    func testAShortHistoryIsNotScrollable() async {
        let notes = (0..<2).map { NoteRecord(text: "note \($0)", at: 1_700_000_000_000 + $0 * 60_000) }
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { notes })
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        guard let historyView = controller.historyViewForTesting else {
            XCTFail("Expected a history list")
            return
        }
        XCTAssertLessThan(historyView.frame.height, NoteHistoryListView.maximumHeight)
        XCTAssertFalse(historyView.isScrollable)
    }

    func testCollapsingHistoryReturnsThePanelToTheBareInputRow() async {
        let notes = (0..<5).map { NoteRecord(text: "note \($0)", at: 1_700_000_000_000 + $0 * 60_000) }
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { notes })
        controller.show()
        await controller.historyLoadForTesting?.value
        let collapsedHeight = controller.panelForTesting?.frame.height

        controller.historyControlForTesting?.performClick(nil)
        let expandedHeight = controller.panelForTesting?.frame.height
        controller.historyControlForTesting?.performClick(nil)

        XCTAssertEqual(collapsedHeight, CapturePanelController.defaultPanelSize.height)
        XCTAssertGreaterThan(expandedHeight ?? 0, collapsedHeight ?? 0)
        XCTAssertEqual(controller.panelForTesting?.frame.height, collapsedHeight)
        XCTAssertEqual(controller.historyViewForTesting?.isHidden, true)
        XCTAssertTrue(controller.historyRowsForTesting.isEmpty)
    }

    func testReopeningAfterAnExpandedHistoryStartsCollapsed() async {
        let notes = (0..<5).map { NoteRecord(text: "note \($0)", at: 1_700_000_000_000 + $0 * 60_000) }
        let controller = CapturePanelController(
            onSubmit: { _ in },
            notesProvider: { notes },
            positionStore: CapturePanelPosition(defaults: makeDefaults()),
            screenProvider: { TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900)) }
        )
        controller.show()
        await controller.historyLoadForTesting?.value
        controller.historyControlForTesting?.performClick(nil)
        let expandedTop = controller.panelForTesting?.frame.maxY
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertFalse(controller.isHistoryExpandedForTesting)
        XCTAssertEqual(controller.historyViewForTesting?.isHidden, true)
        XCTAssertTrue(controller.historyRowsForTesting.isEmpty)
        XCTAssertEqual(controller.panelForTesting?.frame.height, CapturePanelController.defaultPanelSize.height)
        XCTAssertEqual(
            controller.panelForTesting?.frame.maxY, expandedTop,
            "the input row reopens where it was left, not where the expanded panel's bottom was"
        )
    }

    // MARK: - Anchored history motion

    func testExpandingNearTheBottomEdgeShiftsThePanelUpToStayFullyVisible() async {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = CapturePanelPosition(defaults: makeDefaults())
        store.record(NSPoint(x: 200, y: 0), for: screen)
        let controller = makeExpandableController(notes: 40, store: store, screen: screen)
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        guard let frame = controller.panelForTesting?.frame else {
            XCTFail("Expected a visible panel")
            return
        }
        XCTAssertGreaterThanOrEqual(frame.minY, screen.visibleFrame.minY)
        XCTAssertLessThanOrEqual(frame.maxY, screen.visibleFrame.maxY)
    }

    func testExpandingAwayFromAnyEdgeGrowsDownwardFromAFixedTopEdge() async {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = CapturePanelPosition(defaults: makeDefaults())
        store.record(NSPoint(x: 200, y: 500), for: screen)
        let controller = makeExpandableController(notes: 5, store: store, screen: screen)
        controller.show()
        await controller.historyLoadForTesting?.value

        guard let collapsed = controller.panelForTesting?.frame else {
            XCTFail("Expected a visible panel")
            return
        }
        controller.historyControlForTesting?.performClick(nil)

        guard let expanded = controller.panelForTesting?.frame else {
            XCTFail("Expected a visible panel")
            return
        }
        XCTAssertEqual(expanded.maxY, collapsed.maxY, "the input row's top edge is the anchor")
        XCTAssertLessThan(expanded.minY, collapsed.minY, "history unfolds downward")
        XCTAssertEqual(expanded.origin.x, collapsed.origin.x)
    }

    func testExpandingOnAShortDisplayCapsTheHistoryToWhatFits() async {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 260))
        let controller = makeExpandableController(notes: 40, screen: screen)
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        guard let frame = controller.panelForTesting?.frame else {
            XCTFail("Expected a visible panel")
            return
        }
        XCTAssertLessThanOrEqual(frame.height, screen.visibleFrame.height)
        XCTAssertGreaterThanOrEqual(frame.minY, screen.visibleFrame.minY)
        XCTAssertLessThanOrEqual(frame.maxY, screen.visibleFrame.maxY)
        XCTAssertTrue(
            controller.historyViewForTesting?.isScrollable == true,
            "history the display cannot fit must still be reachable by scrolling"
        )
    }

    func testExpandingTransitionsHeightAndHistoryOpacityOverOneDuration() async {
        let controller = makeExpandableController(notes: 5, reduceMotion: false)
        controller.show()
        await controller.historyLoadForTesting?.value
        let collapsedHeight = controller.panelForTesting?.frame.height ?? 0

        controller.historyControlForTesting?.performClick(nil)

        XCTAssertEqual(
            controller.lastHistoryTransitionForTesting,
            CapturePanelController.HistoryTransition(
                duration: CapturePanelController.historyTransitionDuration,
                isExpanding: true
            ),
            "height and opacity must move together over the disclosure duration"
        )
        XCTAssertGreaterThan(controller.panelForTesting?.frame.height ?? 0, collapsedHeight)
        XCTAssertEqual(controller.historyViewForTesting?.isHidden, false)
        XCTAssertEqual(controller.historyViewForTesting?.alphaValue ?? 0, 1, accuracy: 0.001)
    }

    func testReduceMotionAppliesTheExpandedAndCollapsedFramesWithoutTransition() async {
        let controller = makeExpandableController(notes: 5, reduceMotion: true)
        controller.show()
        await controller.historyLoadForTesting?.value
        let collapsedHeight = controller.panelForTesting?.frame.height ?? 0

        controller.historyControlForTesting?.performClick(nil)

        XCTAssertEqual(controller.lastHistoryTransitionForTesting?.duration, 0)
        XCTAssertGreaterThan(controller.panelForTesting?.frame.height ?? 0, collapsedHeight)
        XCTAssertEqual(controller.historyViewForTesting?.alphaValue ?? 0, 1, accuracy: 0.001)

        controller.historyControlForTesting?.performClick(nil)

        XCTAssertEqual(controller.lastHistoryTransitionForTesting?.duration, 0)
        XCTAssertEqual(controller.panelForTesting?.frame.height, collapsedHeight)
    }

    func testCollapsingReversesTheSameTransition() async {
        let controller = makeExpandableController(notes: 5, reduceMotion: false)
        controller.show()
        await controller.historyLoadForTesting?.value
        guard let collapsed = controller.panelForTesting?.frame else {
            XCTFail("Expected a visible panel")
            return
        }

        controller.historyControlForTesting?.performClick(nil)
        controller.historyControlForTesting?.performClick(nil)

        XCTAssertEqual(
            controller.lastHistoryTransitionForTesting,
            CapturePanelController.HistoryTransition(
                duration: CapturePanelController.historyTransitionDuration,
                isExpanding: false
            )
        )
        XCTAssertEqual(controller.panelForTesting?.frame, collapsed, "collapsing undoes the growth exactly")
        XCTAssertEqual(controller.historyViewForTesting?.isHidden, true)
        XCTAssertTrue(controller.historyRowsForTesting.isEmpty)
    }

    func testTypingSurvivesTheAnimatedExpandAndCollapse() async {
        let controller = makeExpandableController(notes: 5, reduceMotion: false)
        controller.show()
        await controller.historyLoadForTesting?.value
        controller.textFieldForTesting?.stringValue = "half-typed"

        controller.historyControlForTesting?.performClick(nil)
        controller.historyControlForTesting?.performClick(nil)

        guard let panel = controller.panelForTesting,
              let field = controller.textFieldForTesting
        else {
            XCTFail("Expected a visible panel")
            return
        }
        XCTAssertEqual(field.stringValue, "half-typed")
        let responder = panel.firstResponder
        XCTAssertTrue(
            responder === field || (responder as? NSTextView)?.delegate === field,
            "the transition must not steal the caret"
        )
    }

    func testTheDisclosureChevronReflectsTheHistoryState() async {
        let controller = makeExpandableController(notes: 5)
        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(
            controller.historyControlForTesting?.image?.accessibilityDescription,
            "Show today's notes"
        )
        XCTAssertEqual(controller.historyControlForTesting?.imagePosition, .imageTrailing)

        controller.historyControlForTesting?.performClick(nil)
        XCTAssertEqual(
            controller.historyControlForTesting?.image?.accessibilityDescription,
            "Hide today's notes"
        )
        XCTAssertEqual(controller.historyControlForTesting?.accessibilityValue() as? String, "expanded")

        controller.historyControlForTesting?.performClick(nil)
        XCTAssertEqual(
            controller.historyControlForTesting?.image?.accessibilityDescription,
            "Show today's notes"
        )
        XCTAssertEqual(controller.historyControlForTesting?.accessibilityValue() as? String, "collapsed")
    }

    // MARK: - ⌘/ disclosure shortcut

    func testCommandSlashTogglesTheHistoryWhileThePanelIsOpen() async {
        let controller = makeExpandableController(notes: 3)
        controller.show()
        await controller.historyLoadForTesting?.value
        XCTAssertFalse(controller.isHistoryExpandedForTesting)

        XCTAssertTrue(sendCommandSlash(to: controller), "⌘/ should be consumed by the panel")
        XCTAssertTrue(controller.isHistoryExpandedForTesting)

        XCTAssertTrue(sendCommandSlash(to: controller))
        XCTAssertFalse(controller.isHistoryExpandedForTesting)
    }

    /// The shortcut has to reach the panel while the input owns the keyboard —
    /// which is always — so what matters is that the note survives it untouched
    /// and the caret stays where it was.
    func testCommandSlashLeavesTheHalfTypedNoteAndItsFocusAlone() async {
        let controller = makeExpandableController(notes: 2)
        controller.show()
        await controller.historyLoadForTesting?.value
        controller.textFieldForTesting?.stringValue = "half-typed"

        _ = sendCommandSlash(to: controller)

        guard let panel = controller.panelForTesting,
              let field = controller.textFieldForTesting
        else {
            XCTFail("Expected a visible panel")
            return
        }
        XCTAssertTrue(controller.isHistoryExpandedForTesting)
        XCTAssertEqual(field.stringValue, "half-typed", "⌘/ must not type a slash")
        XCTAssertTrue(panel.isVisible)
        XCTAssertTrue(
            panel.firstResponder === field || panel.firstResponder === field.currentEditor(),
            "focus should stay in the input"
        )
    }

    /// Same gate as the click: with the count unreadable there is nothing to
    /// disclose, so the shortcut is inert rather than opening an empty drawer.
    func testCommandSlashDoesNothingWhenTodaysNotesCouldNotBeRead() async {
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { nil })
        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertFalse(sendCommandSlash(to: controller))
        XCTAssertFalse(controller.isHistoryExpandedForTesting)
    }

    func testTheDisclosureControlAdvertisesItsShortcut() {
        let controller = makeExpandableController(notes: 1)
        controller.show()

        XCTAssertEqual(controller.historyControlForTesting?.keyEquivalent, "/")
        XCTAssertEqual(
            controller.historyControlForTesting?.keyEquivalentModifierMask,
            [.command]
        )
        XCTAssertEqual(controller.historyControlForTesting?.toolTip, "Show today's notes (⌘/)")
    }

    /// Dispatches ⌘/ the way AppKit does for a key window — through
    /// `performKeyEquivalent`, not by calling the action directly — so the test
    /// fails if the shortcut stops being wired to the panel at all.
    private func sendCommandSlash(to controller: CapturePanelController) -> Bool {
        guard let panel = controller.panelForTesting,
              let event = NSEvent.keyEvent(
                  with: .keyDown,
                  location: .zero,
                  modifierFlags: [.command],
                  timestamp: 0,
                  windowNumber: panel.windowNumber,
                  context: nil,
                  characters: "/",
                  charactersIgnoringModifiers: "/",
                  isARepeat: false,
                  keyCode: 44
              )
        else {
            XCTFail("Expected a panel and a synthesizable ⌘/ event")
            return false
        }
        return panel.performKeyEquivalent(with: event)
    }

    func testTheDisclosureTransitionIsRestrained() {
        XCTAssertEqual(CapturePanelController.historyTransitionDuration, 0.18, accuracy: 0.001)
    }

    func testDefaultTimestampsUseTheSystemLocaleAndTimePreference() {
        let noon = Date(timeIntervalSince1970: 1_700_000_000)

        XCTAssertEqual(
            NoteHistory.localizedTime(for: noon),
            DateFormatter.localizedString(from: noon, dateStyle: .none, timeStyle: .short)
        )
    }

    func testReturnSubmitsEmptyTextVerbatimForCliToNoOp() {
        var submitted: [String] = []
        let controller = CapturePanelController(onSubmit: { submitted.append($0) })
        controller.show()
        controller.textFieldForTesting?.stringValue = ""

        controller.sendCommandForTesting(#selector(NSResponder.insertNewline(_:)))

        XCTAssertEqual(submitted, [""])
    }

    // MARK: - Movable, remembered placement

    func testFirstInvocationUsesTheDefaultPlacementForTheActiveDisplay() {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = CapturePanelPosition(defaults: makeDefaults())
        let controller = CapturePanelController(
            onSubmit: { _ in },
            positionStore: store,
            screenProvider: { screen }
        )

        controller.show()

        let expected = store.defaultPosition(for: screen, windowSize: CapturePanelController.defaultPanelSize)
        XCTAssertEqual(controller.panelForTesting?.frame.origin, expected)
    }

    func testDismissingRecordsWhereThePanelWasDraggedTo() {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = CapturePanelPosition(defaults: makeDefaults())
        let controller = CapturePanelController(
            onSubmit: { _ in },
            positionStore: store,
            screenProvider: { screen }
        )
        controller.show()
        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 333, y: 444))

        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        XCTAssertEqual(store.position(for: screen), NSPoint(x: 333, y: 444))
    }

    func testSubmittingRecordsWhereThePanelWasDraggedTo() {
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let store = CapturePanelPosition(defaults: makeDefaults())
        let controller = CapturePanelController(
            onSubmit: { _ in },
            positionStore: store,
            screenProvider: { screen }
        )
        controller.show()
        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 210, y: 620))

        controller.sendCommandForTesting(#selector(NSResponder.insertNewline(_:)))

        XCTAssertEqual(store.position(for: screen), NSPoint(x: 210, y: 620))
    }

    func testReopeningRestoresTheSavedPositionOfTheActiveDisplay() {
        let left = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let right = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))
        var activeScreen: NSScreen? = left
        let store = CapturePanelPosition(defaults: makeDefaults())
        let controller = CapturePanelController(
            onSubmit: { _ in },
            positionStore: store,
            screenProvider: { activeScreen }
        )

        controller.show()
        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 120, y: 340))
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        controller.show()
        XCTAssertEqual(controller.panelForTesting?.frame.origin, NSPoint(x: 120, y: 340))

        // A second display keeps its own placement rather than inheriting the first's.
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))
        activeScreen = right
        controller.show()
        XCTAssertEqual(
            controller.panelForTesting?.frame.origin,
            store.defaultPosition(for: right, windowSize: CapturePanelController.defaultPanelSize)
        )
        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 1600, y: 800))
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        activeScreen = left
        controller.show()
        XCTAssertEqual(controller.panelForTesting?.frame.origin, NSPoint(x: 120, y: 340))
        controller.sendCommandForTesting(#selector(NSResponder.cancelOperation(_:)))

        activeScreen = right
        controller.show()
        XCTAssertEqual(controller.panelForTesting?.frame.origin, NSPoint(x: 1600, y: 800))
    }

    func testBackgroundAndBrandMarkDragThePanelWhileControlsDoNot() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertEqual(controller.panelForTesting?.isMovableByWindowBackground, true)
        XCTAssertEqual(
            controller.surfaceViewForTesting?.mouseDownCanMoveWindow, true,
            "the noninteractive row background must be a drag handle"
        )
        XCTAssertEqual(
            controller.iconViewForTesting?.mouseDownCanMoveWindow, true,
            "the pmdr mark must be a drag handle"
        )
        XCTAssertEqual(
            controller.textFieldForTesting?.mouseDownCanMoveWindow, false,
            "clicking the input must place the caret, not drag the panel"
        )
        XCTAssertEqual(
            controller.historyControlForTesting?.mouseDownCanMoveWindow, false,
            "clicking Today · N must toggle history, not drag the panel"
        )
    }

    func testDraggingThePanelDoesNotInterruptTyping() {
        var submitted: [String] = []
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let controller = CapturePanelController(
            onSubmit: { submitted.append($0) },
            positionStore: CapturePanelPosition(defaults: makeDefaults()),
            screenProvider: { screen }
        )
        controller.show()
        controller.textFieldForTesting?.stringValue = "half-typed"

        controller.panelForTesting?.setFrameOrigin(NSPoint(x: 700, y: 100))

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
            "moving the panel must not drop the caret"
        )
        controller.sendCommandForTesting(#selector(NSResponder.insertNewline(_:)))
        XCTAssertEqual(submitted, ["half-typed"])
    }

    // MARK: - Assistive technology acceptance

    func testTheDisclosureControlAnnouncesTheCurrentNoteCount() async {
        let controller = makeExpandableController(notes: 3)

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(
            controller.historyControlForTesting?.accessibilityLabel(),
            "Today's notes: 3",
            "an accessibility label replaces the button title, so it has to carry the count"
        )
    }

    func testKeyboardFocusMovesFromTheInputToTheDisclosureControlAndBack() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertTrue(
            controller.textFieldForTesting?.nextKeyView === controller.historyControlForTesting,
            "Tab from the input must reach the disclosure control"
        )
        XCTAssertTrue(
            controller.historyControlForTesting?.nextKeyView === controller.textFieldForTesting,
            "the row's focus loop must return to the input rather than dead-end"
        )
        XCTAssertTrue(
            controller.panelForTesting?.initialFirstResponder === controller.textFieldForTesting,
            "keyboard focus must start on the input"
        )
    }

    func testEachHistoryRowIsOneVoiceOverItemAnnouncingItsTimeAndText() async {
        let controller = makeExpandableController(notes: 2)
        controller.show()
        await controller.historyLoadForTesting?.value

        controller.historyControlForTesting?.performClick(nil)

        guard let newest = controller.historyRowsForTesting.first else {
            XCTFail("Expected the expanded history to have rows")
            return
        }
        XCTAssertTrue(newest.isAccessibilityElement(), "a note must be a single VoiceOver stop")
        XCTAssertEqual(newest.accessibilityRole(), .staticText)
        let announced = newest.accessibilityLabel() ?? ""
        XCTAssertTrue(
            announced.contains(newest.timeLabel.stringValue) && announced.contains("note 1"),
            "expected the capture time and note text in one announcement, got \(announced)"
        )
        XCTAssertFalse(
            newest.timeLabel.isAccessibilityElement(),
            "the time must not be a separate stop from its note"
        )
        XCTAssertFalse(
            newest.textLabel.isAccessibilityElement(),
            "the text must not be a separate stop from its time"
        )
    }

    func testAnUnreadableCountIsAnnouncedAsUnavailableRatherThanAsZero() async {
        let controller = CapturePanelController(onSubmit: { _ in }, notesProvider: { nil })

        controller.show()
        await controller.historyLoadForTesting?.value

        XCTAssertEqual(
            controller.historyControlForTesting?.accessibilityLabel(),
            "Today's notes: count unavailable"
        )
    }

    func testTheBrandMarkIsDecorativeForVoiceOver() {
        let controller = CapturePanelController(onSubmit: { _ in })

        controller.show()

        XCTAssertEqual(
            controller.iconViewForTesting?.isAccessibilityElement(), false,
            "the mark carries no information; VoiceOver should land on the input"
        )
    }

    /// A controller with `count` notes ready to expand on a stubbed display.
    private func makeExpandableController(
        notes count: Int,
        store: CapturePanelPosition? = nil,
        screen: NSScreen? = nil,
        reduceMotion: Bool = true
    ) -> CapturePanelController {
        let notes = (0..<count).map { NoteRecord(text: "note \($0)", at: 1_700_000_000_000 + $0 * 60_000) }
        let screen = screen ?? TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        return CapturePanelController(
            onSubmit: { _ in },
            notesProvider: { notes },
            positionStore: store ?? CapturePanelPosition(defaults: makeDefaults()),
            screenProvider: { screen },
            reduceMotionProvider: { reduceMotion }
        )
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "CapturePanelControllerTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        addTeardownBlock { defaults.removePersistentDomain(forName: suiteName) }
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
