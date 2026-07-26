import AppKit
import XCTest

@MainActor
final class LoginItemMenuItemTests: XCTestCase {
    func test_item_is_titled_launch_at_login() {
        let item = LoginItemMenuItem.make(enabled: false, target: nil, action: nil)
        XCTAssertEqual(item.title, "Launch at login")
    }

    func test_item_is_checked_when_the_login_item_is_enabled() {
        let item = LoginItemMenuItem.make(enabled: true, target: nil, action: nil)
        XCTAssertEqual(item.state, .on)
    }

    func test_item_is_unchecked_when_the_login_item_is_disabled() {
        let item = LoginItemMenuItem.make(enabled: false, target: nil, action: nil)
        XCTAssertEqual(item.state, .off)
    }

    func test_item_routes_clicks_to_the_supplied_target_and_action() {
        // A menu item with a nil target falls back to the first responder,
        // which for a status-bar menu means the click goes nowhere.
        let target = NSObject()
        let action = #selector(NSObject.description as () -> String)
        let item = LoginItemMenuItem.make(enabled: false, target: target, action: action)
        XCTAssertTrue(item.target === target)
        XCTAssertEqual(item.action, action)
    }
}
