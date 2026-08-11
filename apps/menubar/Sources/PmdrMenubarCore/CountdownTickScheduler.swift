import Foundation

/// Maintains one pending redraw aligned to the active countdown's next visible
/// second boundary. Call `reschedule(for:)` whenever the applied status changes.
public final class CountdownTickScheduler {
    public typealias Cancellation = () -> Void
    public typealias Schedule = (
        _ delay: TimeInterval,
        _ action: @escaping () -> Void
    ) -> Cancellation

    private let now: () -> Date
    private let schedule: Schedule
    private let redraw: () -> Void
    private var status: Status = .idle()
    private var cancellation: Cancellation?
    private var generation: UInt64 = 0

    public init(
        now: @escaping () -> Date = Date.init,
        schedule: @escaping Schedule,
        redraw: @escaping () -> Void
    ) {
        self.now = now
        self.schedule = schedule
        self.redraw = redraw
    }

    public func reschedule(for status: Status) {
        generation &+= 1
        cancellation?()
        cancellation = nil
        self.status = status
        scheduleNext(generation: generation)
    }

    public func stop() {
        generation &+= 1
        cancellation?()
        cancellation = nil
    }

    private func scheduleNext(generation: UInt64) {
        guard
            case .running(let active) = status,
            let endsAt = active.endsAt,
            let delay = Self.nextDelay(endsAt: endsAt, now: now())
        else {
            return
        }

        cancellation = schedule(delay) { [weak self] in
            self?.tick(generation: generation)
        }
    }

    private func tick(generation: UInt64) {
        guard self.generation == generation else { return }
        cancellation = nil
        redraw()
        scheduleNext(generation: generation)
    }

    static func nextDelay(endsAt: Int, now: Date) -> TimeInterval? {
        let remainingMs = Double(endsAt) - now.timeIntervalSince1970 * 1_000
        guard remainingMs > 0 else { return nil }

        let remainder = remainingMs.truncatingRemainder(dividingBy: 1_000)
        let millisecondsToBoundary = remainder == 0 ? 1_000 : remainder
        return (millisecondsToBoundary + 1) / 1_000
    }
}
