import AppKit
import Foundation

public struct FloatingTimerPosition {
    public static let defaultInset: CGFloat = 24

    private let defaults: UserDefaults
    private let key: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = "FloatingTimerPosition.positions"
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

    public func defaultPosition(for screen: NSScreen, windowSize: NSSize) -> NSPoint {
        let frame = screen.visibleFrame
        return NSPoint(
            x: frame.maxX - windowSize.width - Self.defaultInset,
            y: frame.maxY - windowSize.height - Self.defaultInset
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
