import AppKit
import XCTest

@MainActor
final class InsightsMenuItemTests: XCTestCase {
    func test_make_buildsInsightsMenuAction() {
        let target = NSObject()
        let action = Selector(("openInsights:"))

        let item = InsightsMenuItem.make(target: target, action: action)

        XCTAssertEqual(item.title, "Insights…")
        XCTAssertTrue(item.target === target)
        XCTAssertEqual(item.action, action)
    }
}
