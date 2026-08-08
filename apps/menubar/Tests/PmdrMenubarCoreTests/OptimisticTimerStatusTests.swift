import XCTest
@testable import PmdrMenubarCore

final class OptimisticTimerStatusTests: XCTestCase {
    func test_pausingRunningBreakImmediatelyBecomesIdle() {
        let status = Status.running(active(phase: .break))

        XCTAssertEqual(
            OptimisticTimerStatus.pausing(status, elapsedMs: 2_000),
            .idle
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

    func test_stoppingActiveTimerImmediatelyBecomesIdle() {
        XCTAssertEqual(
            OptimisticTimerStatus.stopping(.running(active(phase: .focus))),
            .idle
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
