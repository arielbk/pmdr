import Foundation

public struct FloatingTimerViewModel: Equatable, Sendable {
    public let time: String
    public let phaseLabel: String
    public let projectName: String
    public let isMuted: Bool

    public init(status: Status, lastProject: String?) {
        switch status {
        case .idle:
            time = "--:--"
            phaseLabel = "idle"
            projectName = lastProject ?? ""
            isMuted = true
        case .running(let active), .paused(let active):
            time = Self.format(remainingMs: active.remainingMs)
            phaseLabel = active.phase.rawValue
            projectName = active.project ?? ""
            isMuted = false
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
