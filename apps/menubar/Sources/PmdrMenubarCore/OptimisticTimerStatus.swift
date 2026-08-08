import Foundation

public enum OptimisticTimerStatus {
    public static func pausing(_ status: Status, elapsedMs: Int) -> Status? {
        guard case .running(let active) = status else { return nil }
        if active.phase == .break {
            return .idle
        }
        return .paused(.init(
            remainingMs: max(0, active.remainingMs - elapsedMs),
            durationMs: active.durationMs,
            startedAt: active.startedAt,
            phase: active.phase,
            completedFocusBlocks: active.completedFocusBlocks,
            todayFocusBlocks: active.todayFocusBlocks,
            project: active.project
        ))
    }

    public static func stopping(_ status: Status) -> Status? {
        switch status {
        case .running, .paused:
            return .idle
        case .idle:
            return nil
        }
    }
}
