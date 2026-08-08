import AppKit
import XCTest
@testable import PmdrMenubarCore

@MainActor
final class InsightsWindowControllerTests: XCTestCase {
    func test_buildsInsightsWindowWithApprovedDateRanges() {
        let log = makeEmptyLog()
        let controller = InsightsWindowController(loadLog: { _ in log })

        XCTAssertEqual(controller.windowForTesting.title, "Insights")
        XCTAssertEqual(controller.rangeControlForTesting.segmentCount, 4)
        XCTAssertEqual(
            (0..<4).map { controller.rangeControlForTesting.label(forSegment: $0) ?? "" },
            ["7 days", "30 days", "90 days", "Custom"]
        )
        XCTAssertEqual(controller.rangeControlForTesting.selectedSegment, 0)
        XCTAssertTrue(controller.customRangeControlsAreHiddenForTesting)
    }

    func test_reload_requestsLatestSevenDays_andRendersSummaryAndProjects() async throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 8,
            hour: 12
        )))
        let log = LogResult(
            from: "2026-08-02",
            to: "2026-08-08",
            days: [
                LogDay(
                    date: "2026-08-07",
                    groups: [
                        LogGroup(project: "Deep Work", pomodoros: 2, totalMs: 3_000_000),
                        LogGroup(project: "Admin", pomodoros: 1, totalMs: 1_500_000),
                    ],
                    total: LogTotal(pomodoros: 3, totalMs: 4_500_000)
                ),
                LogDay(
                    date: "2026-08-08",
                    groups: [LogGroup(project: "Deep Work", pomodoros: 1, totalMs: 1_500_000)],
                    total: LogTotal(pomodoros: 1, totalMs: 1_500_000)
                ),
            ],
            total: LogTotal(pomodoros: 4, totalMs: 6_000_000)
        )
        let controller = InsightsWindowController(loadLog: { _ in log }, now: { now }, calendar: calendar)

        await controller.reloadForTesting()

        XCTAssertEqual(
            controller.lastRequestedRangeForTesting,
            InsightsDateRange(from: "2026-08-02", to: "2026-08-08")
        )
        XCTAssertEqual(controller.summaryTextForTesting, ["1h 40m", "4", "2"])
        XCTAssertEqual(controller.projectTitlesForTesting, ["All projects", "Deep Work", "Admin"])
        XCTAssertEqual(controller.chartProjectStacksForTesting, [
            [], [], [], [], [], ["Deep Work", "Admin"], ["Deep Work"],
        ])
        XCTAssertEqual(controller.allocationRowsForTesting, [
            "Deep Work|1h 15m|75%",
            "Admin|25m|25%",
        ])
        XCTAssertEqual(controller.projectMixScopeForTesting, "All projects in selected range")

        controller.selectProjectForTesting("Deep Work")

        XCTAssertEqual(controller.summaryTextForTesting, ["1h 15m", "3", "2"])
        XCTAssertEqual(controller.projectTitlesForTesting, ["All projects", "Deep Work", "Admin"])
        XCTAssertEqual(controller.chartProjectStacksForTesting, [
            [], [], [], [], [], ["Deep Work"], ["Deep Work"],
        ])
        XCTAssertEqual(controller.allocationRowsForTesting, [
            "Deep Work|1h 15m|75%",
            "Admin|25m|25%",
        ])
    }

    func test_switchingPreset_requestsThirtyDayRange() async throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 8,
            hour: 12
        )))
        let log = makeEmptyLog()
        let controller = InsightsWindowController(loadLog: { _ in log }, now: { now }, calendar: calendar)

        await controller.selectRangeForTesting(segment: 1)

        XCTAssertEqual(
            controller.lastRequestedRangeForTesting,
            InsightsDateRange(from: "2026-07-10", to: "2026-08-08")
        )
        XCTAssertTrue(controller.customRangeControlsAreHiddenForTesting)
    }

    func test_projectMix_exposesTheWholeCompositionAsOneAccessibleGraphic() async {
        let log = LogResult(
            from: "2026-08-02",
            to: "2026-08-08",
            days: [
                LogDay(
                    date: "2026-08-08",
                    groups: [
                        LogGroup(project: "Deep Work", pomodoros: 3, totalMs: 4_500_000),
                        LogGroup(project: "Admin", pomodoros: 1, totalMs: 1_500_000),
                    ],
                    total: LogTotal(pomodoros: 4, totalMs: 6_000_000)
                ),
            ],
            total: LogTotal(pomodoros: 4, totalMs: 6_000_000)
        )
        let controller = InsightsWindowController(loadLog: { _ in log })

        await controller.reloadForTesting()

        XCTAssertEqual(
            controller.projectMixAccessibilityForTesting,
            "Deep Work 75%, Admin 25%"
        )
    }

    func test_summaryCards_pairConciseValuesWithDescriptiveLabels() async {
        let range = InsightsDateRange(from: "2026-08-02", to: "2026-08-08")
        let controller = InsightsWindowController(loadLog: { _ in
            makeLog(range: range, pomodoros: 2)
        })

        await controller.reloadForTesting()

        XCTAssertEqual(controller.summaryTextForTesting, ["50m", "2", "1"])
        XCTAssertEqual(
            controller.summaryCaptionsForTesting,
            ["Focus time", "Sessions", "Active days"]
        )
    }

    func test_customRange_requestsTheSelectedInclusiveDates() async throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let from = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 7, day: 1)))
        let to = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 7, day: 15)))
        let log = makeEmptyLog()
        let controller = InsightsWindowController(loadLog: { _ in log }, calendar: calendar)

        await controller.setCustomRangeForTesting(from: from, to: to)

        XCTAssertEqual(
            controller.lastRequestedRangeForTesting,
            InsightsDateRange(from: "2026-07-01", to: "2026-07-15")
        )
        XCTAssertFalse(controller.customRangeControlsAreHiddenForTesting)
    }

    func test_emptyRange_surfacesAnEmptyState() async {
        let log = makeEmptyLog()
        let controller = InsightsWindowController(loadLog: { _ in log })

        await controller.reloadForTesting()

        XCTAssertEqual(controller.statusMessageForTesting, "No focus sessions in this range")
        XCTAssertEqual(controller.summaryTextForTesting, ["0m", "0", "0"])
    }

    func test_loaderFailure_surfacesAnErrorState() async {
        enum LoadFailure: Error { case unavailable }
        let controller = InsightsWindowController(loadLog: { _ in throw LoadFailure.unavailable })

        await controller.reloadForTesting()

        XCTAssertEqual(controller.statusMessageForTesting, "Couldn’t load insights.")
        XCTAssertEqual(controller.summaryTextForTesting, ["Unable to load", "—", "—"])
    }

    func test_reload_surfacesLoadingStateWhileTheCLIRequestIsInFlight() async {
        let log = makeEmptyLog()
        let controller = InsightsWindowController(loadLog: { _ in
            try await Task.sleep(nanoseconds: 100_000_000)
            return log
        })

        let reload = Task { await controller.reloadForTesting() }
        await Task.yield()

        XCTAssertEqual(controller.statusMessageForTesting, "Loading…")
        await reload.value
    }

    func test_newerRangeSelection_cannotBeOverwrittenByAnOlderSlowResponse() async throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 8,
            hour: 12
        )))
        let sevenDays = InsightsDateRange(from: "2026-08-02", to: "2026-08-08")
        let slowLog = makeLog(range: sevenDays, pomodoros: 1)
        let fastLog = makeLog(
            range: InsightsDateRange(from: "2026-07-10", to: "2026-08-08"),
            pomodoros: 2
        )
        let controller = InsightsWindowController(loadLog: { range in
            if range == sevenDays {
                try await Task.sleep(nanoseconds: 100_000_000)
                return slowLog
            }
            return fastLog
        }, now: { now }, calendar: calendar)

        let initialReload = Task { await controller.reloadForTesting() }
        await Task.yield()
        await controller.selectRangeForTesting(segment: 1)
        await initialReload.value

        XCTAssertEqual(controller.summaryTextForTesting, ["50m", "2", "1"])
    }

}

private func makeEmptyLog() -> LogResult {
    LogResult(
        from: "2026-08-02",
        to: "2026-08-08",
        days: [],
        total: LogTotal(pomodoros: 0, totalMs: 0)
    )
}

private func makeLog(range: InsightsDateRange, pomodoros: Int) -> LogResult {
    let totalMs = pomodoros * 1_500_000
    return LogResult(
        from: range.from,
        to: range.to,
        days: [
            LogDay(
                date: range.to,
                groups: [LogGroup(project: "Deep Work", pomodoros: pomodoros, totalMs: totalMs)],
                total: LogTotal(pomodoros: pomodoros, totalMs: totalMs)
            ),
        ],
        total: LogTotal(pomodoros: pomodoros, totalMs: totalMs)
    )
}
