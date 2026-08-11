import XCTest
@testable import PmdrMenubarCore

final class OptimisticTimerStatusTests: XCTestCase {
    func test_pausingRunningBreakImmediatelyBecomesIdleWithoutClearingTodaysProgress() {
        let status = Status.running(active(phase: .break))

        XCTAssertEqual(
            OptimisticTimerStatus.pausing(status, nowMs: 42_000),
            .idle(todayFocusBlocks: 3)
        )
    }

    func test_pausingRunningFocusFreezesAtInterpolatedRemainingTime() {
        let active = active(phase: .focus)

        XCTAssertEqual(
            OptimisticTimerStatus.pausing(.running(active), nowMs: 42_000),
            .paused(.init(
                remainingMs: 58_000,
                durationMs: active.durationMs,
                startedAt: active.startedAt,
                phase: .focus,
                completedFocusBlocks: active.completedFocusBlocks,
                todayFocusBlocks: active.todayFocusBlocks,
                project: active.project
            ))
        )
    }

    func test_resumingPausedTimer_sets_new_end_time_from_frozen_remaining() {
        let active = active(phase: .focus, endsAt: nil)

        XCTAssertEqual(
            OptimisticTimerStatus.resuming(.paused(active), nowMs: 42_000),
            .running(.init(
                remainingMs: active.remainingMs,
                endsAt: 102_000,
                durationMs: active.durationMs,
                startedAt: active.startedAt,
                phase: active.phase,
                completedFocusBlocks: active.completedFocusBlocks,
                todayFocusBlocks: active.todayFocusBlocks,
                project: active.project
            ))
        )
    }

    func test_startingTimer_sets_end_time_from_duration() {
        XCTAssertEqual(
            OptimisticTimerStatus.starting(
                durationMs: 60_000,
                nowMs: 42_000,
                project: "Deep Work"
            ),
            .running(.init(
                remainingMs: 60_000,
                endsAt: 102_000,
                durationMs: 60_000,
                startedAt: 42_000,
                phase: .focus,
                completedFocusBlocks: 0,
                project: "Deep Work"
            ))
        )
    }

    func test_stoppingActiveTimerImmediatelyBecomesIdleWithoutClearingTodaysProgress() {
        XCTAssertEqual(
            OptimisticTimerStatus.stopping(.running(active(phase: .focus))),
            .idle(todayFocusBlocks: 3)
        )
    }

    private func active(phase: Phase, endsAt: Int? = 100_000) -> Status.Active {
        Status.Active(
            remainingMs: 60_000,
            endsAt: endsAt,
            durationMs: 300_000,
            startedAt: 0,
            phase: phase,
            completedFocusBlocks: 2,
            todayFocusBlocks: 3,
            project: "Deep Work"
        )
    }
}
