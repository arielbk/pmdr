import AppKit
import XCTest
@testable import PmdrMenubarCore

final class CapturePanelPositionTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "CapturePanelPositionTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func test_recordedPositionRoundTripsForDisplay() {
        let store = CapturePanelPosition(defaults: defaults)
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))

        store.record(NSPoint(x: 111, y: 222), for: screen)

        XCTAssertEqual(store.position(for: screen), NSPoint(x: 111, y: 222))
    }

    func test_recordedPositionsCoexistPerDisplay() {
        let store = CapturePanelPosition(defaults: defaults)
        let left = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let right = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))

        store.record(NSPoint(x: 50, y: 60), for: left)
        store.record(NSPoint(x: 1550, y: 700), for: right)

        XCTAssertEqual(store.position(for: left), NSPoint(x: 50, y: 60))
        XCTAssertEqual(store.position(for: right), NSPoint(x: 1550, y: 700))
    }

    func test_positionReturnsNilForUnknownDisplay() {
        let store = CapturePanelPosition(defaults: defaults)
        let known = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let unknown = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))

        store.record(NSPoint(x: 50, y: 60), for: known)

        XCTAssertNil(store.position(for: unknown))
    }

    func test_captureAndTimerPositionsAreStoredIndependently() {
        let capture = CapturePanelPosition(defaults: defaults)
        let timer = FloatingTimerPosition(defaults: defaults)
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))

        timer.record(NSPoint(x: 10, y: 20), for: screen)
        capture.record(NSPoint(x: 300, y: 400), for: screen)

        XCTAssertEqual(timer.position(for: screen), NSPoint(x: 10, y: 20))
        XCTAssertEqual(capture.position(for: screen), NSPoint(x: 300, y: 400))
    }

    func test_defaultPositionIsHorizontallyCentredAboveTheMidline() {
        let store = CapturePanelPosition(defaults: defaults)
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 100, y: 50, width: 1440, height: 900))
        let size = NSSize(width: 520, height: 86)

        let position = store.defaultPosition(for: screen, windowSize: size)

        let visible = screen.visibleFrame
        XCTAssertEqual(position.x, visible.midX - size.width / 2)
        XCTAssertEqual(position.y, visible.midY + visible.height / 6)
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
