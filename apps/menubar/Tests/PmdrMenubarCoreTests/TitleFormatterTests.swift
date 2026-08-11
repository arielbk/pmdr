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

    // MARK: - title(for:at:)

    func test_title_idle_is_empty() {
        XCTAssertEqual(TitleFormatter.title(for: .idle()), "")
    }

    func test_title_running_uses_endsAt_relative_to_now() {
        let active = Status.Active(
            remainingMs: 999_000,
            endsAt: 220_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        XCTAssertEqual(
            TitleFormatter.title(
                for: .running(active),
                at: Date(timeIntervalSince1970: 100)
            ),
            "2:00"
        )
    }

    func test_title_paused_uses_remaining_and_ignores_wall_clock() {
        let active = Status.Active(
            remainingMs: 600_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        XCTAssertEqual(
            TitleFormatter.title(
                for: .paused(active),
                at: Date(timeIntervalSince1970: 10_000)
            ),
            "10:00"
        )
    }

    func test_title_running_same_endsAt_cannot_shift_when_late_poll_arrives() {
        let earlyPayload = Status.Active(
            remainingMs: 120_000,
            endsAt: 220_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        let latePayload = Status.Active(
            remainingMs: 119_400,
            endsAt: 220_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        let now = Date(timeIntervalSince1970: 105)

        XCTAssertEqual(
            TitleFormatter.title(for: .running(earlyPayload), at: now),
            TitleFormatter.title(for: .running(latePayload), at: now)
        )
        XCTAssertEqual(TitleFormatter.title(for: .running(latePayload), at: now), "1:55")
    }

    func test_title_running_clamps_to_zero_after_endsAt() {
        let active = Status.Active(
            remainingMs: 1_000,
            endsAt: 101_000,
            durationMs: 1_500_000,
            startedAt: 0,
            phase: .focus,
            completedFocusBlocks: 0
        )
        XCTAssertEqual(
            TitleFormatter.title(
                for: .running(active),
                at: Date(timeIntervalSince1970: 110)
            ),
            "0:00"
        )
    }
}
