import AppKit
import Foundation

/// Per-display saved placement for the quick-note capture panel.
///
/// Deliberately separate from `FloatingTimerPosition`: the two overlays are
/// dragged independently and default to different corners of the screen, so
/// they must not share a defaults key.
public struct CapturePanelPosition {
    private let defaults: UserDefaults
    private let key: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = "CapturePanelPosition.positions"
    ) {
        self.defaults = defaults
        self.key = key
    }

    public func position(for screen: NSScreen) -> NSPoint? {
        guard let displayKey = Self.displayKey(for: screen),
              let stored = positions()[displayKey],
              let x = stored["x"],
              let y = stored["y"]
        else {
            return nil
        }

        return NSPoint(x: x, y: y)
    }

    public func record(_ point: NSPoint, for screen: NSScreen) {
        guard let displayKey = Self.displayKey(for: screen) else { return }

        var positions = positions()
        positions[displayKey] = ["x": point.x, "y": point.y]
        defaults.set(positions, forKey: key)
    }

    /// Horizontally centred and a third of the way up from the middle — the
    /// spotlight-ish placement capture has always used on first invocation.
    public func defaultPosition(for screen: NSScreen, windowSize: NSSize) -> NSPoint {
        let visible = screen.visibleFrame
        return NSPoint(
            x: visible.midX - windowSize.width / 2,
            y: visible.midY + visible.height / 6
        )
    }

    private func positions() -> [String: [String: CGFloat]] {
        defaults.dictionary(forKey: key) as? [String: [String: CGFloat]] ?? [:]
    }

    private static func displayKey(for screen: NSScreen) -> String? {
        let screenNumberKey = NSDeviceDescriptionKey("NSScreenNumber")
        if let displayID = screen.deviceDescription[screenNumberKey] as? NSNumber {
            return displayID.stringValue
        }

        return nil
    }
}
