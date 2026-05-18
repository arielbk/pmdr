import XCTest
@testable import PmdrMenubarCore

final class TitleFormatterTests: XCTestCase {
    // MARK: - format(remainingMs:)

    func test_format_25_minutes_exact() {
        XCTAssertEqual(TitleFormatter.format(remainingMs: 1_500_000), "25:00")
    }

    func test_format_just_under_a_second_rounds_up() {
        // 1ms remaining still reads as "0:01" until it actually hits zero.
        XCTAssertEqual(TitleFormatter.format(remainingMs: 1), "0:01")
    }

    func test_format_zero_is_double_zero() {
        XCTAssertEqual(TitleFormatter.format(remainingMs: 0), "0:00")
    }

    func test_format_negative_clamps_to_zero() {
        XCTAssertEqual(TitleFormatter.format(remainingMs: -1_000), "0:00")
    }

    func test_format_uses_ceiling_within_second() {
        // 1499500ms = 24m 59.5s — round up so the leading second shows "25:00".
        XCTAssertEqual(TitleFormatter.format(remainingMs: 1_499_500), "25:00")
        // 1499000ms = exactly 24m 59s — no rounding needed.
        XCTAssertEqual(TitleFormatter.format(remainingMs: 1_499_000), "24:59")
    }

    func test_format_pads_seconds() {
        XCTAssertEqual(TitleFormatter.format(remainingMs: 65_000), "1:05")
    }

    // MARK: - title(for:elapsedSincePoll:)

    func test_title_idle_is_empty() {
        XCTAssertEqual(TitleFormatter.title(for: .idle), "")
        XCTAssertEqual(TitleFormatter.title(for: .idle, elapsedSincePoll: 5), "")
    }

    func test_title_running_uses_remaining() {
        let active = Status.Active(
            remainingMs: 120_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        XCTAssertEqual(TitleFormatter.title(for: .running(active)), "2:00")
    }

    func test_title_paused_uses_remaining_and_ignores_elapsed() {
        let active = Status.Active(
            remainingMs: 600_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        // Pause freezes the clock — elapsed time since the poll should be ignored.
        XCTAssertEqual(
            TitleFormatter.title(for: .paused(active), elapsedSincePoll: 10),
            "10:00"
        )
    }

    func test_title_running_interpolates_elapsed_seconds() {
        let active = Status.Active(
            remainingMs: 1_500_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        XCTAssertEqual(
            TitleFormatter.title(for: .running(active), elapsedSincePoll: 5),
            "24:55"
        )
    }

    func test_title_running_clamps_to_zero_when_elapsed_overshoots() {
        let active = Status.Active(
            remainingMs: 1_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        XCTAssertEqual(
            TitleFormatter.title(for: .running(active), elapsedSincePoll: 10),
            "0:00"
        )
    }
}
