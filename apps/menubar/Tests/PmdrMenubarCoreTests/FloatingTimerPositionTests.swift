import AppKit
import XCTest
@testable import PmdrMenubarCore

final class FloatingTimerPositionTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "FloatingTimerPositionTests-\(UUID().uuidString)"
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
        let store = FloatingTimerPosition(defaults: defaults)
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let point = NSPoint(x: 111, y: 222)

        store.record(point, for: screen)

        XCTAssertEqual(store.position(for: screen), point)
    }

    func test_recordedPositionsCoexistPerDisplay() {
        let store = FloatingTimerPosition(defaults: defaults)
        let left = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let right = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))

        store.record(NSPoint(x: 50, y: 60), for: left)
        store.record(NSPoint(x: 1550, y: 700), for: right)

        XCTAssertEqual(store.position(for: left), NSPoint(x: 50, y: 60))
        XCTAssertEqual(store.position(for: right), NSPoint(x: 1550, y: 700))
    }

    func test_positionReturnsNilForUnknownDisplay() {
        let store = FloatingTimerPosition(defaults: defaults)
        let known = TestScreen(displayID: 100, frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        let unknown = TestScreen(displayID: 200, frame: NSRect(x: 1440, y: 0, width: 1920, height: 1080))

        store.record(NSPoint(x: 50, y: 60), for: known)

        XCTAssertNil(store.position(for: unknown))
    }

    func test_defaultPositionAnchorsAtTopRightWithInset() {
        let store = FloatingTimerPosition(defaults: defaults)
        let screen = TestScreen(displayID: 100, frame: NSRect(x: 100, y: 50, width: 1440, height: 900))

        let position = store.defaultPosition(for: screen, windowSize: NSSize(width: 220, height: 72))

        XCTAssertEqual(position.x, 100 + 1440 - 220 - FloatingTimerPosition.defaultInset)
        XCTAssertEqual(position.y, 50 + 900 - 72 - FloatingTimerPosition.defaultInset)
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
