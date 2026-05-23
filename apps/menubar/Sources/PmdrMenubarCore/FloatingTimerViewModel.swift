import Foundation

public struct FloatingTimerViewModel: Equatable, Sendable {
    public enum PhaseColor: Equatable, Sendable {
        case focus
        case `break`
        case muted
    }

    public let time: String
    public let phaseLabel: String
    public let projectName: String
    public let isMuted: Bool
    public let phaseColor: PhaseColor
    public let completedFocusBlocks: Int

    public init(status: Status, lastProject: String?, elapsedSincePoll: TimeInterval = 0) {
        switch status {
        case .idle:
            time = "--:--"
            phaseLabel = "idle"
            projectName = lastProject ?? ""
            isMuted = true
            phaseColor = .muted
            completedFocusBlocks = 0
        case .running(let active):
            time = Self.format(remainingMs: active.remainingMs - Int(elapsedSincePoll * 1000))
            phaseLabel = active.phase.rawValue
            projectName = active.project ?? ""
            isMuted = false
            phaseColor = active.phase == .focus ? .focus : .break
            completedFocusBlocks = active.completedFocusBlocks
        case .paused(let active):
            time = Self.format(remainingMs: active.remainingMs)
            phaseLabel = active.phase.rawValue
            projectName = active.project ?? ""
            isMuted = false
            phaseColor = .muted
            completedFocusBlocks = active.completedFocusBlocks
        }
    }

    private static func format(remainingMs: Int) -> String {
        guard remainingMs > 0 else { return "00:00" }
        let totalSeconds = Int((Double(remainingMs) / 1000.0).rounded(.up))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}
