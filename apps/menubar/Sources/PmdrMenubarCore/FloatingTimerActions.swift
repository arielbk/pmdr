import Foundation

/// Action sink for the floating timer panel. Implementers map UI events to
/// concrete CLI calls without leaking `PmdrClient` into the controller.
public protocol FloatingTimerActions: AnyObject {
    func start(project: String?)
    func pause()
    func resume()
    func stop()
    func setProject(_ project: String?)
    func addProject(_ name: String)
    func listProjects() -> [ProjectRecord]

    /// App-level destinations the overlay exposes through its menu button. The
    /// status item can be swallowed by the notch on a crowded menu bar, and the
    /// overlay has its own global hotkey, so it doubles as the way in.
    func openSettings()
    func openInsights()
    func openManageProjects()
    func quit()
}

public extension FloatingTimerActions {
    func openSettings() {}
    func openInsights() {}
    func openManageProjects() {}
    func quit() {}
}
