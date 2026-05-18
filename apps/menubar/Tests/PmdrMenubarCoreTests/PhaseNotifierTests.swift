import XCTest
@testable import PmdrMenubarCore

private actor RecordingPresenter: NotificationPresenting {
    struct Call: Equatable {
        let title: String
        let body: String
    }

    private(set) var calls: [Call] = []

    func present(title: String, body: String) async {
        calls.append(Call(title: title, body: body))
    }
}

private func makeActive(phase: Phase = .focus) -> Status.Active {
    .init(
        remainingMs: 1_500_000,
        durationMs: 1_500_000,
        startedAt: 1_700_000_000_000,
        phase: phase,
        completedFocusBlocks: 0
    )
}

final class PhaseNotifierTests: XCTestCase {
    func test_focus_to_break_presents_focus_done_banner() async {
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([
            .statusChanged(.running(makeActive(phase: .break))),
            .phaseTransition(from: .focus, to: .break),
        ])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [
            .init(title: "Focus done", body: "Break started"),
        ])
    }

    func test_session_ended_break_presents_break_done_banner() async {
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([
            .statusChanged(.idle),
            .sessionEnded(lastPhase: .break),
        ])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [
            .init(title: "Break done", body: ""),
        ])
    }

    func test_session_ended_focus_does_not_present_anything() async {
        // Manual `pmdr stop` during a focus block: no banner per spec.
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([
            .statusChanged(.idle),
            .sessionEnded(lastPhase: .focus),
        ])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [])
    }

    func test_break_to_focus_does_not_present_anything() async {
        // No notification on starting a new focus block from a break.
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([
            .statusChanged(.running(makeActive(phase: .focus))),
            .phaseTransition(from: .break, to: .focus),
        ])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [])
    }

    func test_status_change_alone_does_not_present_anything() async {
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([
            .statusChanged(.running(makeActive(phase: .focus))),
        ])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [])
    }

    func test_empty_event_list_presents_nothing() async {
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [])
    }

    func test_multiple_handle_calls_accumulate_one_banner_per_transition() async {
        // One poll cycle's events should fire once. A subsequent cycle with no
        // matching event should not re-fire. (The poller dedups same-status
        // polls, so the notifier doesn't need its own dedup state.)
        let presenter = RecordingPresenter()
        let notifier = PhaseNotifier(presenter: presenter)
        await notifier.handle([
            .statusChanged(.running(makeActive(phase: .break))),
            .phaseTransition(from: .focus, to: .break),
        ])
        await notifier.handle([])
        await notifier.handle([
            .statusChanged(.idle),
            .sessionEnded(lastPhase: .break),
        ])
        let calls = await presenter.calls
        XCTAssertEqual(calls, [
            .init(title: "Focus done", body: "Break started"),
            .init(title: "Break done", body: ""),
        ])
    }
}
