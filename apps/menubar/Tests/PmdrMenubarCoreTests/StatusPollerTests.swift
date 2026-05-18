import XCTest
@testable import PmdrMenubarCore

private actor StubFetcher: StatusFetching {
    private var results: [Result<Status, Error>]
    private(set) var calls: Int = 0

    init(_ results: [Result<Status, Error>]) {
        self.results = results
    }

    func status() async throws -> Status {
        calls += 1
        guard !results.isEmpty else {
            throw PmdrClientError.binaryNotFound
        }
        return try results.removeFirst().get()
    }
}

private func makeActive(
    remainingMs: Int = 1_500_000,
    durationMs: Int = 1_500_000,
    startedAt: Int = 1_700_000_000_000,
    phase: Phase = .focus,
    completed: Int = 0
) -> Status.Active {
    .init(
        remainingMs: remainingMs,
        durationMs: durationMs,
        startedAt: startedAt,
        phase: phase,
        completedFocusBlocks: completed
    )
}

final class StatusPollerTests: XCTestCase {
    func test_cadence_default_is_closed() async {
        let poller = StatusPoller(fetcher: StubFetcher([]))
        let cadence = await poller.cadence
        XCTAssertEqual(cadence, StatusPoller.closedCadence)
    }

    func test_setMenuOpen_true_switches_to_open_cadence() async {
        let poller = StatusPoller(fetcher: StubFetcher([]))
        await poller.setMenuOpen(true)
        let cadence = await poller.cadence
        XCTAssertEqual(cadence, StatusPoller.openCadence)
    }

    func test_setMenuOpen_false_returns_to_closed_cadence() async {
        let poller = StatusPoller(fetcher: StubFetcher([]))
        await poller.setMenuOpen(true)
        await poller.setMenuOpen(false)
        let cadence = await poller.cadence
        XCTAssertEqual(cadence, StatusPoller.closedCadence)
    }

    func test_first_poll_emits_statusChanged() async throws {
        let poller = StatusPoller(fetcher: StubFetcher([.success(.idle)]))
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [.statusChanged(.idle)])
    }

    func test_consecutive_identical_polls_emit_no_event_second_time() async throws {
        let poller = StatusPoller(fetcher: StubFetcher([.success(.idle), .success(.idle)]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [])
    }

    func test_status_change_idle_to_running_emits_statusChanged() async throws {
        let active = makeActive()
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.idle),
            .success(.running(active)),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [.statusChanged(.running(active))])
    }

    func test_focus_to_break_emits_phaseTransition() async throws {
        let focus = makeActive(phase: .focus)
        let brk = makeActive(remainingMs: 300_000, durationMs: 300_000, phase: .break)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.running(focus)),
            .success(.running(brk)),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [
            .statusChanged(.running(brk)),
            .phaseTransition(from: .focus, to: .break),
        ])
    }

    func test_same_phase_emits_no_phaseTransition() async throws {
        let a = makeActive(remainingMs: 1_500_000, phase: .focus)
        let b = makeActive(remainingMs: 1_499_000, phase: .focus)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.running(a)),
            .success(.running(b)),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [.statusChanged(.running(b))])
    }

    func test_idle_in_between_resets_phase_baseline() async throws {
        let focus = makeActive(phase: .focus)
        let brk = makeActive(remainingMs: 300_000, durationMs: 300_000, phase: .break)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.running(focus)),
            .success(.idle),
            .success(.running(brk)),
        ]))
        _ = try await poller.pollOnce()
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        // Going idle → running(break) should NOT emit a focus→break phaseTransition,
        // because the previous focus block is finished as far as the poller is concerned.
        XCTAssertEqual(events, [.statusChanged(.running(brk))])
    }

    func test_break_to_idle_emits_sessionEnded_break() async throws {
        let brk = makeActive(remainingMs: 1_000, durationMs: 300_000, phase: .break)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.running(brk)),
            .success(.idle),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [
            .statusChanged(.idle),
            .sessionEnded(lastPhase: .break),
        ])
    }

    func test_focus_to_idle_emits_sessionEnded_focus() async throws {
        let focus = makeActive(phase: .focus)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.running(focus)),
            .success(.idle),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [
            .statusChanged(.idle),
            .sessionEnded(lastPhase: .focus),
        ])
    }

    func test_paused_to_idle_emits_sessionEnded() async throws {
        let active = makeActive(phase: .focus)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.paused(active)),
            .success(.idle),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [
            .statusChanged(.idle),
            .sessionEnded(lastPhase: .focus),
        ])
    }

    func test_first_poll_idle_does_not_emit_sessionEnded() async throws {
        let poller = StatusPoller(fetcher: StubFetcher([.success(.idle)]))
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [.statusChanged(.idle)])
    }

    func test_idle_to_idle_emits_no_sessionEnded() async throws {
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.idle),
            .success(.idle),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [])
    }

    func test_focus_to_break_does_not_emit_sessionEnded() async throws {
        let focus = makeActive(phase: .focus)
        let brk = makeActive(remainingMs: 300_000, durationMs: 300_000, phase: .break)
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.running(focus)),
            .success(.running(brk)),
        ]))
        _ = try await poller.pollOnce()
        let events = try await poller.pollOnce()
        XCTAssertEqual(events, [
            .statusChanged(.running(brk)),
            .phaseTransition(from: .focus, to: .break),
        ])
    }

    func test_poll_propagates_fetcher_errors() async {
        struct Boom: Error, Equatable {}
        let poller = StatusPoller(fetcher: StubFetcher([.failure(Boom())]))
        do {
            _ = try await poller.pollOnce()
            XCTFail("expected throw")
        } catch is Boom {
            // ok
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func test_currentStatus_reflects_last_successful_poll() async throws {
        let active = makeActive()
        let poller = StatusPoller(fetcher: StubFetcher([
            .success(.idle),
            .success(.running(active)),
        ]))
        _ = try await poller.pollOnce()
        var current = await poller.currentStatus()
        XCTAssertEqual(current, .idle)
        _ = try await poller.pollOnce()
        current = await poller.currentStatus()
        XCTAssertEqual(current, .running(active))
    }
}
