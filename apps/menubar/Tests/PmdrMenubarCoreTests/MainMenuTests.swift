import AppKit
import XCTest

@MainActor
final class MainMenuTests: XCTestCase {
    private func editMenu() -> NSMenu? {
        MainMenu.build().items.first { $0.submenu?.title == "Edit" }?.submenu
    }

    func testBuildsAnEditMenu() {
        XCTAssertNotNil(editMenu(), "Main menu should contain an Edit menu")
    }

    func testEditMenuRoutesStandardKeyEquivalentsToFirstResponder() {
        guard let edit = editMenu() else {
            XCTFail("Expected an Edit menu")
            return
        }

        let expected: [(key: String, action: Selector)] = [
            ("x", #selector(NSText.cut(_:))),
            ("c", #selector(NSText.copy(_:))),
            ("v", #selector(NSText.paste(_:))),
            ("a", #selector(NSText.selectAll(_:))),
        ]

        for (key, action) in expected {
            let item = edit.items.first { $0.keyEquivalent == key }
            XCTAssertNotNil(item, "Expected an Edit item for ⌘\(key.uppercased())")
            XCTAssertEqual(item?.action, action)
            XCTAssertNil(item?.target, "Edit items must target the first responder")
            XCTAssertEqual(item?.keyEquivalentModifierMask, .command)
        }
    }
}
