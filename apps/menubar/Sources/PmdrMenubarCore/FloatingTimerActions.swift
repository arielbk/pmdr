import Foundation

/// Action sink for the floating timer panel. Implementers map UI events to
/// concrete CLI calls without leaking `PmdrClient` into the controller.
public protocol FloatingTimerActions: AnyObject {
    func start(project: String?)
    func pause()
    func resume()
    func stop()
    func setProject(_ project: String?)
    func listProjects() -> [ProjectRecord]
}
