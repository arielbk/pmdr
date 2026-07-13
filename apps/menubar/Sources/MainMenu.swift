import AppKit

/// Builds the app's main menu.
///
/// The app is an accessory (`LSUIElement`) with no visible menu bar, but AppKit
/// still resolves ⌘-key equivalents through `NSApp.mainMenu`. Without an Edit
/// menu there is nothing for ⌘V/⌘C/⌘X/⌘A/⌘Z to match, so text fields — the
/// capture panel, Settings, Manage projects — beep instead of pasting. The
/// items target the first responder (nil target), which is the field editor
/// whenever a text field has focus.
enum MainMenu {
    static func build() -> NSMenu {
        let main = NSMenu()

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(
            withTitle: "Select All",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        editItem.submenu = edit
        main.addItem(editItem)

        return main
    }
}
