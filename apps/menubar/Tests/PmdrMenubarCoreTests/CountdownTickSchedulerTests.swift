import XCTest
@testable import PmdrMenubarCore

final class CountdownTickSchedulerTests: XCTestCase {
    func test_firstRedrawIsScheduledJustAfterNextEndsAtBoundary() throws {
        let clock = TestClock(Date(timeIntervalSince1970: 100.250))
        let timers = TestTimerQueue()
        var redrawCount = 0
        let scheduler = CountdownTickScheduler(
            now: { clock.now },
            schedule: timers.schedule,
            redraw: { redrawCount += 1 }
        )

        scheduler.reschedule(for: .running(active(endsAt: 102_000)))

        let timer = try XCTUnwrap(timers.activeTimers.first)
        XCTAssertEqual(timer.delay, 0.751, accuracy: 0.000_1)

        clock.now = Date(timeIntervalSince1970: 101.001)
        timer.fire()

        XCTAssertEqual(redrawCount, 1)
        XCTAssertEqual(timers.activeTimers.count, 1)
        XCTAssertEqual(timers.activeTimers[0].delay, 1.0, accuracy: 0.000_1)
    }

    func test_pollPauseResumeAndStartReplaceRatherThanDuplicatePendingTick() {
        let clock = TestClock(Date(timeIntervalSince1970: 100.250))
        let timers = TestTimerQueue()
        let scheduler = CountdownTickScheduler(
            now: { clock.now },
            schedule: timers.schedule,
            redraw: {}
        )

        scheduler.reschedule(for: .running(active(endsAt: 102_000)))
        let firstPollTimer = timers.activeTimers[0]

        scheduler.reschedule(for: .running(active(endsAt: 102_000)))
        XCTAssertTrue(firstPollTimer.isCancelled)
        XCTAssertEqual(timers.activeTimers.count, 1)
        let secondPollTimer = timers.activeTimers[0]

        scheduler.reschedule(for: .paused(active(endsAt: nil)))
        XCTAssertTrue(secondPollTimer.isCancelled)
        XCTAssertEqual(timers.activeTimers.count, 0)

        scheduler.reschedule(for: .running(active(endsAt: 120_000)))
        XCTAssertEqual(timers.activeTimers.count, 1)
        let resumeTimer = timers.activeTimers[0]

        scheduler.reschedule(for: .running(active(endsAt: 160_000)))
        XCTAssertTrue(resumeTimer.isCancelled)
        XCTAssertEqual(timers.activeTimers.count, 1)

        scheduler.stop()
        XCTAssertEqual(timers.activeTimers.count, 0)
    }

    private func active(endsAt: Int?) -> Status.Active {
        Status.Active(
            remainingMs: 60_000,
            endsAt: endsAt,
            durationMs: 60_000,
            startedAt: 42_000,
            phase: .focus,
            completedFocusBlocks: 0
        )
    }
}

private final class TestClock {
    var now: Date

    init(_ now: Date) {
        self.now = now
    }
}

private final class TestTimerQueue {
    final class ScheduledTimer {
        let delay: TimeInterval
        private let action: () -> Void
        private(set) var isCancelled = false

        init(delay: TimeInterval, action: @escaping () -> Void) {
            self.delay = delay
            self.action = action
        }

        func cancel() {
            isCancelled = true
        }

        func fire() {
            guard !isCancelled else { return }
            isCancelled = true
            action()
        }
    }

    private(set) var timers: [ScheduledTimer] = []
    var activeTimers: [ScheduledTimer] { timers.filter { !$0.isCancelled } }

    lazy var schedule: CountdownTickScheduler.Schedule = { [weak self] delay, action in
        let timer = ScheduledTimer(delay: delay, action: action)
        self?.timers.append(timer)
        return { timer.cancel() }
    }
}
