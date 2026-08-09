import XCTest
@testable import PmdrMenubarCore

final class OptimisticTimerStatusTests: XCTestCase {
    func test_pausingRunningBreakImmediatelyBecomesIdleWithoutClearingTodaysProgress() {
        let status = Status.running(active(phase: .break))

        XCTAssertEqual(
            OptimisticTimerStatus.pausing(status, elapsedMs: 2_000),
            .idle(todayFocusBlocks: 3)
        )
    }

    func test_pausingRunningFocusFreezesAtInterpolatedRemainingTime() {
        let active = active(phase: .focus)

        XCTAssertEqual(
            OptimisticTimerStatus.pausing(.running(active), elapsedMs: 2_000),
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

    func test_stoppingActiveTimerImmediatelyBecomesIdleWithoutClearingTodaysProgress() {
        XCTAssertEqual(
            OptimisticTimerStatus.stopping(.running(active(phase: .focus))),
            .idle(todayFocusBlocks: 3)
        )
    }

    private func active(phase: Phase) -> Status.Active {
        Status.Active(
            remainingMs: 60_000,
            durationMs: 300_000,
            startedAt: 0,
            phase: phase,
            completedFocusBlocks: 2,
            todayFocusBlocks: 3,
            project: "Deep Work"
        )
    }
}
