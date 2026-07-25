import XCTest
@testable import PmdrMenubarCore

final class MenuBarIconStyleTests: XCTestCase {
    private func active(phase: Phase) -> Status.Active {
        Status.Active(
            remainingMs: 300_000,
            durationMs: 300_000,
            startedAt: 0,
            phase: phase,
            completedFocusBlocks: 0
        )
    }

    // MARK: - weight

    func test_running_focus_is_filled() {
        let style = MenuBarIconStyle(status: .running(active(phase: .focus)))
        XCTAssertEqual(style.weight, .filled)
    }

    func test_running_break_is_outline() {
        let style = MenuBarIconStyle(status: .running(active(phase: .break)))
        XCTAssertEqual(style.weight, .outline)
    }

    func test_idle_is_outline() {
        XCTAssertEqual(MenuBarIconStyle(status: .idle).weight, .outline)
    }

    func test_pausing_preserves_the_phase_weight() {
        // Pausing dims the mark but must not change which phase it depicts —
        // otherwise pausing a focus block would look like slipping into a break.
        XCTAssertEqual(MenuBarIconStyle(status: .paused(active(phase: .focus))).weight, .filled)
        XCTAssertEqual(MenuBarIconStyle(status: .paused(active(phase: .break))).weight, .outline)
    }

    // MARK: - isDimmed

    func test_paused_is_dimmed_in_either_phase() {
        XCTAssertTrue(MenuBarIconStyle(status: .paused(active(phase: .focus))).isDimmed)
        XCTAssertTrue(MenuBarIconStyle(status: .paused(active(phase: .break))).isDimmed)
    }

    func test_running_is_not_dimmed() {
        XCTAssertFalse(MenuBarIconStyle(status: .running(active(phase: .focus))).isDimmed)
        XCTAssertFalse(MenuBarIconStyle(status: .running(active(phase: .break))).isDimmed)
    }

    func test_idle_is_not_dimmed() {
        // Idle already reads as inactive by showing no countdown at all, so the
        // mark stays at full strength and remains a crisp click target.
        XCTAssertFalse(MenuBarIconStyle(status: .idle).isDimmed)
    }

    // MARK: - accessibilityLabel

    func test_accessibility_label_names_the_phase() {
        XCTAssertEqual(
            MenuBarIconStyle(status: .running(active(phase: .focus))).accessibilityLabel,
            "pmdr — focus"
        )
        XCTAssertEqual(
            MenuBarIconStyle(status: .running(active(phase: .break))).accessibilityLabel,
            "pmdr — break"
        )
    }

    func test_accessibility_label_says_paused() {
        XCTAssertEqual(
            MenuBarIconStyle(status: .paused(active(phase: .focus))).accessibilityLabel,
            "pmdr — focus, paused"
        )
    }

    func test_accessibility_label_idle() {
        XCTAssertEqual(MenuBarIconStyle(status: .idle).accessibilityLabel, "pmdr — idle")
    }

    // MARK: - all four active states are distinguishable

    func test_the_four_active_states_are_pairwise_distinct() {
        let styles = [
            MenuBarIconStyle(status: .running(active(phase: .focus))),
            MenuBarIconStyle(status: .running(active(phase: .break))),
            MenuBarIconStyle(status: .paused(active(phase: .focus))),
            MenuBarIconStyle(status: .paused(active(phase: .break))),
        ]
        XCTAssertEqual(Set(styles).count, 4)
    }
}
