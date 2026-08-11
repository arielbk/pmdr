import Foundation

/// Formats `Status` into the string the menubar `NSStatusItem` shows as its title.
///
/// Idle → empty (icon only, no text).
/// Active → `M:SS` countdown. Running time is derived from the absolute end time;
/// paused time stays frozen at the payload's remaining duration.
public enum TitleFormatter {
    public static func title(for status: Status, at date: Date = Date()) -> String {
        switch status {
        case .idle:
            return ""
        case .paused(let active):
            return format(remainingMs: active.remainingMs)
        case .running(let active):
            guard let endsAt = active.endsAt else { return "0:00" }
            let nowMs = Int(date.timeIntervalSince1970 * 1000)
            return format(remainingMs: endsAt - nowMs)
        }
    }

    /// Round milliseconds up to whole seconds so the visible "M:SS" matches a
    /// human-readable countdown — e.g. 1ms left still reads as "0:01" until it
    /// crosses zero.
    public static func format(remainingMs: Int) -> String {
        guard remainingMs > 0 else { return "0:00" }
        let totalSeconds = Int((Double(remainingMs) / 1000.0).rounded(.up))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
