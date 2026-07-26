import AppKit

/// Builds the "Launch at login" item for the status-bar menu.
///
/// The checkmark mirrors the LaunchAgent plist that the CLI owns — this builder
/// only renders whatever state it is handed, so the menu can never disagree
/// with `pmdr app status --json` on its own initiative.
enum LoginItemMenuItem {
    static let title = "Launch at login"

    static func make(enabled: Bool, target: AnyObject?, action: Selector?) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = target
        item.state = enabled ? .on : .off
        return item
    }
}
