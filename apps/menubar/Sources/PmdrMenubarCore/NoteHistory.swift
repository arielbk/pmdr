import Foundation

/// Presentation rules for today's captured notes.
///
/// The CLI hands back the day's notes ascending by capture time; the overlay
/// shows the most recent first and renders capture times in whatever locale and
/// 12/24-hour preference the user's system is set to.
public enum NoteHistory {
    /// Most recently captured note first.
    public static func newestFirst(_ notes: [NoteRecord]) -> [NoteRecord] {
        notes.sorted { $0.at > $1.at }
    }

    public static func date(forEpochMilliseconds milliseconds: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
    }

    /// Short, system-localized time-of-day, e.g. `4:12 PM` or `16:12`.
    public static func localizedTime(for date: Date) -> String {
        formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}
