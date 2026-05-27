import XCTest
@testable import PmdrMenubarCore

final class FloatingTimerViewModelTests: XCTestCase {
    func test_idle_withLastProject_isMutedAndShowsLastProject() {
        let viewModel = FloatingTimerViewModel(status: .idle, lastProject: "Writing")

        XCTAssertEqual(viewModel.time, "--:--")
        XCTAssertEqual(viewModel.phaseLabel, "idle")
        XCTAssertEqual(viewModel.projectName, "Writing")
        XCTAssertTrue(viewModel.isMuted)
    }

    func test_idle_withoutLastProject_hasEmptyProjectName() {
        let viewModel = FloatingTimerViewModel(status: .idle, lastProject: nil)

        XCTAssertEqual(viewModel.time, "--:--")
        XCTAssertEqual(viewModel.phaseLabel, "idle")
        XCTAssertEqual(viewModel.projectName, "")
        XCTAssertTrue(viewModel.isMuted)
    }

    func test_runningFocus_showsCountdownPhaseAndActiveProject() {
        let viewModel = FloatingTimerViewModel(
            status: .running(active(remainingMs: 1_499_000, phase: .focus, project: "Deep Work")),
            lastProject: "Admin"
        )

        XCTAssertEqual(viewModel.time, "24:59")
        XCTAssertEqual(viewModel.phaseLabel, "focus")
        XCTAssertEqual(viewModel.projectName, "Deep Work")
        XCTAssertFalse(viewModel.isMuted)
    }

    func test_runningBreak_showsCountdownPhaseAndActiveProject() {
        let viewModel = FloatingTimerViewModel(
            status: .running(active(remainingMs: 300_000, phase: .break, project: "Deep Work")),
            lastProject: nil
        )

        XCTAssertEqual(viewModel.time, "05:00")
        XCTAssertEqual(viewModel.phaseLabel, "break")
        XCTAssertEqual(viewModel.projectName, "Deep Work")
        XCTAssertFalse(viewModel.isMuted)
    }

    func test_pausedFocus_showsFrozenCountdownPhaseAndActiveProject() {
        let viewModel = FloatingTimerViewModel(
            status: .paused(active(remainingMs: 600_000, phase: .focus, project: "Planning")),
            lastProject: nil
        )

        XCTAssertEqual(viewModel.time, "10:00")
        XCTAssertEqual(viewModel.phaseLabel, "focus")
        XCTAssertEqual(viewModel.projectName, "Planning")
        XCTAssertFalse(viewModel.isMuted)
    }

    func test_pausedBreak_showsFrozenCountdownPhaseAndActiveProject() {
        let viewModel = FloatingTimerViewModel(
            status: .paused(active(remainingMs: 45_000, phase: .break, project: "Planning")),
            lastProject: "Writing"
        )

        XCTAssertEqual(viewModel.time, "00:45")
        XCTAssertEqual(viewModel.phaseLabel, "break")
        XCTAssertEqual(viewModel.projectName, "Planning")
        XCTAssertFalse(viewModel.isMuted)
    }

    func test_phaseColor_isMutedForIdle() {
        let vm = FloatingTimerViewModel(status: .idle, lastProject: nil)
        XCTAssertEqual(vm.phaseColor, .muted)
    }

    func test_phaseColor_isFocusForRunningFocus() {
        let vm = FloatingTimerViewModel(
            status: .running(active(remainingMs: 60_000, phase: .focus, project: nil)),
            lastProject: nil
        )
        XCTAssertEqual(vm.phaseColor, .focus)
    }

    func test_phaseColor_isBreakForRunningBreak() {
        let vm = FloatingTimerViewModel(
            status: .running(active(remainingMs: 60_000, phase: .break, project: nil)),
            lastProject: nil
        )
        XCTAssertEqual(vm.phaseColor, .break)
    }

    func test_phaseColor_isMutedForPaused() {
        let vm = FloatingTimerViewModel(
            status: .paused(active(remainingMs: 60_000, phase: .focus, project: nil)),
            lastProject: nil
        )
        XCTAssertEqual(vm.phaseColor, .muted)
    }

    func test_completedFocusBlocks_isZeroForIdle() {
        let vm = FloatingTimerViewModel(status: .idle, lastProject: nil)
        XCTAssertEqual(vm.completedFocusBlocks, 0)
    }

    func test_completedFocusBlocks_reflectsActiveValue() {
        let vm = FloatingTimerViewModel(
            status: .running(active(remainingMs: 60_000, phase: .focus, project: nil, todayFocusBlocks: 3)),
            lastProject: nil
        )
        XCTAssertEqual(vm.completedFocusBlocks, 3)
    }

    private func active(
        remainingMs: Int,
        phase: Phase,
        project: String?,
        completedFocusBlocks: Int = 0,
        todayFocusBlocks: Int = 0
    ) -> Status.Active {
        Status.Active(
            remainingMs: remainingMs,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: phase,
            completedFocusBlocks: completedFocusBlocks,
            todayFocusBlocks: todayFocusBlocks,
            project: project
        )
    }
}
