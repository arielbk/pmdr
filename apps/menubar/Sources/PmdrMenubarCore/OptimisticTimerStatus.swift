import Foundation

public enum OptimisticTimerStatus {
    public static func pausing(_ status: Status, nowMs: Int) -> Status? {
        guard case .running(let active) = status else { return nil }
        if active.phase == .break {
            return .idle(todayFocusBlocks: active.todayFocusBlocks)
        }
        guard let endsAt = active.endsAt else { return nil }
        return .paused(.init(
            remainingMs: max(0, endsAt - nowMs),
            durationMs: active.durationMs,
            startedAt: active.startedAt,
            phase: active.phase,
            completedFocusBlocks: active.completedFocusBlocks,
            todayFocusBlocks: active.todayFocusBlocks,
            project: active.project
        ))
    }

    public static func resuming(_ status: Status, nowMs: Int) -> Status? {
        guard case .paused(let active) = status else { return nil }
        return .running(.init(
            remainingMs: active.remainingMs,
            endsAt: nowMs + active.remainingMs,
            durationMs: active.durationMs,
            startedAt: active.startedAt,
            phase: active.phase,
            completedFocusBlocks: active.completedFocusBlocks,
            todayFocusBlocks: active.todayFocusBlocks,
            project: active.project
        ))
    }

    public static func starting(durationMs: Int, nowMs: Int, project: String?) -> Status {
        .running(.init(
            remainingMs: durationMs,
            endsAt: nowMs + durationMs,
            durationMs: durationMs,
            startedAt: nowMs,
            phase: .focus,
            completedFocusBlocks: 0,
            project: project
        ))
    }

    public static func stopping(_ status: Status) -> Status? {
        switch status {
        case .running(let active), .paused(let active):
            return .idle(todayFocusBlocks: active.todayFocusBlocks)
        case .idle:
            return nil
        }
    }
}
