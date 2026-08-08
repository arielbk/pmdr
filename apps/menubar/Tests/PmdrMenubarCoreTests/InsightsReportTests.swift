import XCTest
@testable import PmdrMenubarCore

final class InsightsReportTests: XCTestCase {
    private let log = LogResult(
        from: "2026-08-01",
        to: "2026-08-02",
        days: [
            LogDay(
                date: "2026-08-01",
                groups: [
                    LogGroup(project: "Deep Work", pomodoros: 2, totalMs: 3_000_000),
                    LogGroup(project: "Admin", pomodoros: 1, totalMs: 1_500_000),
                ],
                total: LogTotal(pomodoros: 3, totalMs: 4_500_000)
            ),
            LogDay(
                date: "2026-08-02",
                groups: [
                    LogGroup(project: "Deep Work", pomodoros: 1, totalMs: 1_500_000),
                ],
                total: LogTotal(pomodoros: 1, totalMs: 1_500_000)
            ),
        ],
        total: LogTotal(pomodoros: 4, totalMs: 6_000_000)
    )

    func test_allProjects_summarizes_focus_sessions_activeDays_and_allocation() {
        let report = InsightsReport(log: log, selectedProject: nil)

        XCTAssertEqual(report.totalFocusMs, 6_000_000)
        XCTAssertEqual(report.sessionCount, 4)
        XCTAssertEqual(report.activeDayCount, 2)
        XCTAssertEqual(report.projects, [
            InsightsProjectSummary(project: "Deep Work", pomodoros: 3, totalMs: 4_500_000, share: 0.75),
            InsightsProjectSummary(project: "Admin", pomodoros: 1, totalMs: 1_500_000, share: 0.25),
        ])
    }

    func test_selectedProject_isolates_its_totals_and_dailyActivity() {
        let report = InsightsReport(log: log, selectedProject: "Deep Work")

        XCTAssertEqual(report.totalFocusMs, 4_500_000)
        XCTAssertEqual(report.sessionCount, 3)
        XCTAssertEqual(report.activeDayCount, 2)
        XCTAssertEqual(report.projects, [
            InsightsProjectSummary(project: "Deep Work", pomodoros: 3, totalMs: 4_500_000, share: 1),
        ])
    }

    func test_dailyTrend_includes_empty_calendarDays_in_the_requested_range() {
        let sparseLog = LogResult(
            from: "2026-08-01",
            to: "2026-08-03",
            days: [
                LogDay(
                    date: "2026-08-01",
                    groups: [LogGroup(project: "Deep Work", pomodoros: 1, totalMs: 1_500_000)],
                    total: LogTotal(pomodoros: 1, totalMs: 1_500_000)
                ),
                LogDay(
                    date: "2026-08-03",
                    groups: [LogGroup(project: "Admin", pomodoros: 1, totalMs: 1_500_000)],
                    total: LogTotal(pomodoros: 1, totalMs: 1_500_000)
                ),
            ],
            total: LogTotal(pomodoros: 2, totalMs: 3_000_000)
        )

        let report = InsightsReport(log: sparseLog, selectedProject: nil)

        XCTAssertEqual(report.days, [
            InsightsDay(
                date: "2026-08-01",
                groups: [LogGroup(project: "Deep Work", pomodoros: 1, totalMs: 1_500_000)]
            ),
            InsightsDay(date: "2026-08-02", groups: []),
            InsightsDay(
                date: "2026-08-03",
                groups: [LogGroup(project: "Admin", pomodoros: 1, totalMs: 1_500_000)]
            ),
        ])
    }
}

final class InsightsDateRangeTests: XCTestCase {
    func test_lastSevenDays_is_inclusive_of_today() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let today = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 8,
            hour: 12
        )))

        XCTAssertEqual(
            InsightsDateRange.last(days: 7, endingAt: today, calendar: calendar),
            InsightsDateRange(from: "2026-08-02", to: "2026-08-08")
        )
    }
}
