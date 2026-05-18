import Foundation

/// Anything that can produce a `Status` snapshot. `PmdrClient` is the production conformer;
/// tests inject stubs.
public protocol StatusFetching: Sendable {
    func status() async throws -> Status
}

extension PmdrClient: StatusFetching {}

/// Drives `StatusFetching` snapshots on a cadence that varies with whether the tray
/// menu is currently open. Emits change events and phase transitions so consumers
/// (AppDelegate, future notification slices) can react without diffing themselves.
///
/// The poller does *not* own a timer — it exposes `pollOnce()` and a `cadence`
/// suggestion. The owner (AppDelegate) decides when to fire next, which keeps the
/// poller deterministic and unit-testable.
public actor StatusPoller {
    public enum Event: Equatable, Sendable {
        case statusChanged(Status)
        case phaseTransition(from: Phase, to: Phase)
    }

    /// Cadence used while the tray menu is open — fast enough for a live `M:SS` tick.
    public static let openCadence: TimeInterval = 1.0
    /// Cadence used while the tray menu is closed — slower since the title is the
    /// only thing the user can see and it interpolates between polls.
    public static let closedCadence: TimeInterval = 5.0

    private let fetcher: StatusFetching
    private var lastStatus: Status?
    private var menuOpen: Bool = false

    public init(fetcher: StatusFetching) {
        self.fetcher = fetcher
    }

    public var cadence: TimeInterval {
        menuOpen ? Self.openCadence : Self.closedCadence
    }

    public func setMenuOpen(_ open: Bool) {
        menuOpen = open
    }

    public func currentStatus() -> Status? {
        lastStatus
    }

    /// Fetch the latest status and return any events that fire as a result. Throws
    /// whatever the fetcher throws — callers decide how to surface errors.
    @discardableResult
    public func pollOnce() async throws -> [Event] {
        let status = try await fetcher.status()
        var events: [Event] = []
        if status != lastStatus {
            events.append(.statusChanged(status))
        }
        if let fromPhase = Self.phase(of: lastStatus),
           let toPhase = Self.phase(of: status),
           fromPhase != toPhase {
            events.append(.phaseTransition(from: fromPhase, to: toPhase))
        }
        lastStatus = status
        return events
    }

    private static func phase(of status: Status?) -> Phase? {
        switch status {
        case .running(let a), .paused(let a):
            return a.phase
        case .idle, .none:
            return nil
        }
    }
}
