import AppKit
import PmdrMenubarCore

/// Builds the menu item that reports a notification-permission problem.
///
/// Deliberately a menu item rather than a modal alert: the denial is permanent
/// until the user changes it in System Settings, so an alert would fire on every
/// single launch. The item appears only while there is a problem and disappears
/// once permission is granted.
enum NotificationWarningMenuItem {
    static let title = "Notifications are off…"

    static func make(
        for authorization: NotificationAuthorization,
        target: AnyObject?,
        action: Selector?
    ) -> NSMenuItem? {
        guard let message = authorization.problemMessage else { return nil }
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = target
        item.toolTip = message
        return item
    }
}
