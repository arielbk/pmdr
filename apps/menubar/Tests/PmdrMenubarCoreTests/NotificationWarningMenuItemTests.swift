import AppKit
import XCTest
@testable import PmdrMenubarCore

@MainActor
final class NotificationWarningMenuItemTests: XCTestCase {
    func test_no_warning_item_when_notifications_are_allowed() {
        XCTAssertNil(
            NotificationWarningMenuItem.make(for: .granted, target: nil, action: nil)
        )
    }

    func test_denied_permission_surfaces_an_item_explaining_how_to_fix_it() {
        let item = NotificationWarningMenuItem.make(for: .denied, target: nil, action: nil)
        XCTAssertEqual(item?.title, "Notifications are off…")
        XCTAssertEqual(item?.toolTip, NotificationAuthorization.denied.problemMessage)
    }

    func test_a_failed_request_surfaces_the_underlying_reason() {
        let item = NotificationWarningMenuItem.make(for: .failed("boom"), target: nil, action: nil)
        XCTAssertNotNil(item)
        XCTAssertEqual(item?.toolTip?.contains("boom"), true)
    }

    func test_item_routes_clicks_to_the_supplied_target_and_action() {
        let target = NSObject()
        let action = #selector(NSObject.description as () -> String)
        let item = NotificationWarningMenuItem.make(for: .denied, target: target, action: action)
        XCTAssertTrue(item?.target === target)
        XCTAssertEqual(item?.action, action)
    }
}
