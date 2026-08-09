import Foundation

public struct InsightsDateRange: Equatable, Sendable {
    public let from: String
    public let to: String

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }

    public static func last(
        days dayCount: Int,
        endingAt date: Date = Date(),
        calendar: Calendar = .current
    ) -> InsightsDateRange {
        let end = calendar.startOfDay(for: date)
        let start = calendar.date(
            byAdding: .day,
            value: -(max(1, dayCount) - 1),
            to: end
        ) ?? end
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return InsightsDateRange(from: formatter.string(from: start), to: formatter.string(from: end))
    }
}

public struct InsightsProjectSummary: Equatable, Sendable {
    public let project: String
    public let pomodoros: Int
    public let totalMs: Int
    public let share: Double

    public init(project: String, pomodoros: Int, totalMs: Int, share: Double) {
        self.project = project
        self.pomodoros = pomodoros
        self.totalMs = totalMs
        self.share = share
    }
}

public struct InsightsDay: Equatable, Sendable {
    public let date: String
    public let groups: [LogGroup]

    public var totalMs: Int { groups.reduce(0) { $0 + $1.totalMs } }

    public init(date: String, groups: [LogGroup]) {
        self.date = date
        self.groups = groups
    }
}

public struct InsightsReport: Equatable, Sendable {
    public let totalFocusMs: Int
    public let sessionCount: Int
    public let activeDayCount: Int
    public let projects: [InsightsProjectSummary]
    public let days: [InsightsDay]

    public init(log: LogResult, selectedProject: String?) {
        let groupsForDay: (LogDay) -> [LogGroup] = { day in
            guard let selectedProject else { return day.groups }
            return day.groups.filter { $0.project == selectedProject }
        }
        let groups = log.days.flatMap(groupsForDay)
        let totalFocusMs = groups.reduce(0) { $0 + $1.totalMs }
        let sessionCount = groups.reduce(0) { $0 + $1.pomodoros }
        let activeDayCount = log.days.filter { !groupsForDay($0).isEmpty }.count

        var totals: [String: (pomodoros: Int, totalMs: Int)] = [:]
        for group in groups {
            let current = totals[group.project, default: (0, 0)]
            totals[group.project] = (
                current.pomodoros + group.pomodoros,
                current.totalMs + group.totalMs
            )
        }

        self.totalFocusMs = totalFocusMs
        self.sessionCount = sessionCount
        self.activeDayCount = activeDayCount
        self.days = Self.calendarDays(from: log.from, to: log.to).map { date in
            let day = log.days.first { $0.date == date }
            return InsightsDay(date: date, groups: day.map(groupsForDay) ?? [])
        }
        self.projects = totals.map { project, value in
            InsightsProjectSummary(
                project: project,
                pomodoros: value.pomodoros,
                totalMs: value.totalMs,
                share: totalFocusMs == 0 ? 0 : Double(value.totalMs) / Double(totalFocusMs)
            )
        }.sorted {
            if $0.totalMs != $1.totalMs { return $0.totalMs > $1.totalMs }
            return $0.project.localizedCaseInsensitiveCompare($1.project) == .orderedAscending
        }
    }

    private static func calendarDays(from: String, to: String) -> [String] {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"

        guard let start = formatter.date(from: from), let end = formatter.date(from: to) else {
            return []
        }

        var dates: [String] = []
        var cursor = start
        while cursor <= end {
            dates.append(formatter.string(from: cursor))
            guard let next = formatter.calendar.date(byAdding: .day, value: 1, to: cursor) else {
                break
            }
            cursor = next
        }
        return dates
    }
}
