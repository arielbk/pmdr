import AppKit
import Foundation
import PmdrMenubarCore

enum InsightsMenuItem {
    static func make(target: AnyObject?, action: Selector?) -> NSMenuItem {
        let item = NSMenuItem(title: "Insights…", action: action, keyEquivalent: "")
        item.target = target
        return item
    }
}

@MainActor
final class InsightsWindowController: NSWindowController {
    typealias LogLoader = @Sendable (InsightsDateRange) async throws -> LogResult

    private let loadLog: LogLoader
    private let now: () -> Date
    private let calendar: Calendar
    private let rangeControl = NSSegmentedControl(
        labels: ["7 days", "30 days", "90 days", "Custom"],
        trackingMode: .selectOne,
        target: nil,
        action: nil
    )
    private let fromPicker = NSDatePicker()
    private let toPicker = NSDatePicker()
    private let customRangeControls = NSStackView()
    private let focusSummary = NSTextField(labelWithString: "—")
    private let sessionSummary = NSTextField(labelWithString: "—")
    private let activeDaySummary = NSTextField(labelWithString: "—")
    private let projectPopup = NSPopUpButton()
    private let chartView = InsightsChartView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let allocationStack = NSStackView()
    private let allocationScrollView = NSScrollView()
    private var allocationRows: [String] = []
    private var lastRequestedRange: InsightsDateRange?
    private var lastLog: LogResult?
    private var loadGeneration: UInt64 = 0

    init(
        loadLog: @escaping LogLoader,
        now: @escaping () -> Date = Date.init,
        calendar: Calendar = .current
    ) {
        self.loadLog = loadLog
        self.now = now
        self.calendar = calendar
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 560),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Insights"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        buildContentView()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func show() {
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        Task { [weak self] in await self?.reload() }
    }

    private func buildContentView() {
        guard let window else { return }
        let content = NSView(frame: window.contentLayoutRect)
        content.autoresizingMask = [.width, .height]

        rangeControl.selectedSegment = 0
        rangeControl.target = self
        rangeControl.action = #selector(rangeChanged(_:))
        rangeControl.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(rangeControl)

        for picker in [fromPicker, toPicker] {
            picker.datePickerStyle = .textFieldAndStepper
            picker.datePickerElements = .yearMonthDay
            picker.target = self
            picker.action = #selector(customDateChanged(_:))
        }
        toPicker.dateValue = now()
        fromPicker.dateValue = calendar.date(byAdding: .day, value: -6, to: now()) ?? now()
        customRangeControls.orientation = .horizontal
        customRangeControls.alignment = .centerY
        customRangeControls.spacing = 8
        customRangeControls.addArrangedSubview(NSTextField(labelWithString: "From"))
        customRangeControls.addArrangedSubview(fromPicker)
        customRangeControls.addArrangedSubview(NSTextField(labelWithString: "to"))
        customRangeControls.addArrangedSubview(toPicker)
        customRangeControls.translatesAutoresizingMaskIntoConstraints = false
        customRangeControls.isHidden = true
        content.addSubview(customRangeControls)

        let summary = NSStackView(views: [
            summaryCard(value: focusSummary, caption: "focus"),
            summaryCard(value: sessionSummary, caption: "completed"),
            summaryCard(value: activeDaySummary, caption: "with focus"),
        ])
        summary.orientation = .horizontal
        summary.distribution = .fillEqually
        summary.spacing = 12
        summary.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(summary)

        let dailyTitle = sectionTitle("Daily focus")
        dailyTitle.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(dailyTitle)

        projectPopup.addItem(withTitle: "All projects")
        projectPopup.target = self
        projectPopup.action = #selector(projectChanged(_:))
        projectPopup.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(projectPopup)

        chartView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(chartView)

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .center
        statusLabel.isHidden = true
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(statusLabel)

        let projectsTitle = sectionTitle("Projects")
        projectsTitle.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(projectsTitle)

        allocationStack.orientation = .vertical
        allocationStack.alignment = .width
        allocationStack.spacing = 10
        allocationStack.translatesAutoresizingMaskIntoConstraints = false
        let allocationDocument = FlippedView()
        allocationDocument.translatesAutoresizingMaskIntoConstraints = false
        allocationDocument.addSubview(allocationStack)
        allocationScrollView.documentView = allocationDocument
        allocationScrollView.drawsBackground = false
        allocationScrollView.hasVerticalScroller = true
        allocationScrollView.autohidesScrollers = true
        allocationScrollView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(allocationScrollView)

        NSLayoutConstraint.activate([
            rangeControl.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            rangeControl.topAnchor.constraint(equalTo: content.topAnchor, constant: 20),
            customRangeControls.leadingAnchor.constraint(equalTo: rangeControl.trailingAnchor, constant: 16),
            customRangeControls.centerYAnchor.constraint(equalTo: rangeControl.centerYAnchor),
            summary.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            summary.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            summary.topAnchor.constraint(equalTo: rangeControl.bottomAnchor, constant: 24),
            summary.heightAnchor.constraint(equalToConstant: 76),
            dailyTitle.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            dailyTitle.topAnchor.constraint(equalTo: summary.bottomAnchor, constant: 24),
            projectPopup.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            projectPopup.centerYAnchor.constraint(equalTo: dailyTitle.centerYAnchor),
            chartView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            chartView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            chartView.topAnchor.constraint(equalTo: dailyTitle.bottomAnchor, constant: 10),
            chartView.heightAnchor.constraint(equalToConstant: 180),
            statusLabel.centerXAnchor.constraint(equalTo: chartView.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: chartView.centerYAnchor),
            projectsTitle.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            projectsTitle.topAnchor.constraint(equalTo: chartView.bottomAnchor, constant: 18),
            allocationScrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            allocationScrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            allocationScrollView.topAnchor.constraint(equalTo: projectsTitle.bottomAnchor, constant: 10),
            allocationScrollView.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -18),
            allocationDocument.leadingAnchor.constraint(equalTo: allocationScrollView.contentView.leadingAnchor),
            allocationDocument.trailingAnchor.constraint(equalTo: allocationScrollView.contentView.trailingAnchor),
            allocationDocument.topAnchor.constraint(equalTo: allocationScrollView.contentView.topAnchor),
            allocationDocument.widthAnchor.constraint(equalTo: allocationScrollView.contentView.widthAnchor),
            allocationStack.leadingAnchor.constraint(equalTo: allocationDocument.leadingAnchor),
            allocationStack.trailingAnchor.constraint(equalTo: allocationDocument.trailingAnchor),
            allocationStack.topAnchor.constraint(equalTo: allocationDocument.topAnchor),
            allocationStack.bottomAnchor.constraint(equalTo: allocationDocument.bottomAnchor),
        ])

        window.contentView = content
    }

    private func summaryCard(value: NSTextField, caption: String) -> NSView {
        value.font = .systemFont(ofSize: 22, weight: .semibold)
        let captionLabel = NSTextField(labelWithString: caption)
        captionLabel.textColor = .secondaryLabelColor
        let stack = NSStackView(views: [value, captionLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 2
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 10, right: 14)
        stack.wantsLayer = true
        stack.layer?.cornerRadius = 10
        stack.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        return stack
    }

    private func sectionTitle(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        return label
    }

    private func currentRange() -> InsightsDateRange {
        if rangeControl.selectedSegment == 3 {
            return customRange()
        }
        let days: Int
        switch rangeControl.selectedSegment {
        case 1: days = 30
        case 2: days = 90
        default: days = 7
        }
        return .last(days: days, endingAt: now(), calendar: calendar)
    }

    private func customRange() -> InsightsDateRange {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return InsightsDateRange(
            from: formatter.string(from: fromPicker.dateValue),
            to: formatter.string(from: toPicker.dateValue)
        )
    }

    @objc private func rangeChanged(_ sender: NSSegmentedControl) {
        customRangeControls.isHidden = sender.selectedSegment != 3
        Task { [weak self] in await self?.reload() }
    }

    @objc private func customDateChanged(_ sender: NSDatePicker) {
        guard rangeControl.selectedSegment == 3 else { return }
        Task { [weak self] in await self?.reload() }
    }

    private func reload() async {
        loadGeneration &+= 1
        let generation = loadGeneration
        let range = currentRange()
        lastRequestedRange = range
        setStatusMessage("Loading…")
        do {
            let log = try await loadLog(range)
            guard generation == loadGeneration else { return }
            render(log)
        } catch {
            guard generation == loadGeneration else { return }
            focusSummary.stringValue = "Unable to load"
            sessionSummary.stringValue = "—"
            activeDaySummary.stringValue = "—"
            setStatusMessage("Couldn’t load insights.")
        }
    }

    private func render(_ log: LogResult) {
        lastLog = log
        let allProjects = InsightsReport(log: log, selectedProject: nil)
        projectPopup.removeAllItems()
        projectPopup.addItem(withTitle: "All projects")
        projectPopup.addItems(withTitles: allProjects.projects.map(\.project))
        render(InsightsReport(log: log, selectedProject: nil))
    }

    private func render(_ report: InsightsReport) {
        focusSummary.stringValue = Self.duration(report.totalFocusMs)
        sessionSummary.stringValue = "\(report.sessionCount) \(report.sessionCount == 1 ? "session" : "sessions")"
        activeDaySummary.stringValue = "\(report.activeDayCount) active \(report.activeDayCount == 1 ? "day" : "days")"
        chartView.report = report
        renderAllocations(report.projects)
        setStatusMessage(report.sessionCount == 0 ? "No focus sessions in this range" : nil)
    }

    private func setStatusMessage(_ message: String?) {
        statusLabel.stringValue = message ?? ""
        statusLabel.isHidden = message == nil
        chartView.isHidden = message != nil
    }

    @objc private func projectChanged(_ sender: NSPopUpButton) {
        guard let lastLog else { return }
        let title = sender.titleOfSelectedItem
        let selectedProject = title == "All projects" ? nil : title
        render(InsightsReport(log: lastLog, selectedProject: selectedProject))
    }

    private func renderAllocations(_ projects: [InsightsProjectSummary]) {
        allocationStack.arrangedSubviews.forEach {
            allocationStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        allocationRows = projects.map {
            "\($0.project)|\(Self.duration($0.totalMs))|\(Int(($0.share * 100).rounded()))%"
        }
        for (index, project) in projects.enumerated() {
            let name = NSTextField(labelWithString: project.project)
            name.lineBreakMode = .byTruncatingTail
            let duration = NSTextField(labelWithString: Self.duration(project.totalMs))
            duration.textColor = .secondaryLabelColor
            duration.alignment = .right
            duration.widthAnchor.constraint(equalToConstant: 70).isActive = true
            let percentage = NSTextField(
                labelWithString: "\(Int((project.share * 100).rounded()))%"
            )
            percentage.textColor = .secondaryLabelColor
            percentage.alignment = .right
            percentage.widthAnchor.constraint(equalToConstant: 44).isActive = true
            let spacer = NSView()
            spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
            let labels = NSStackView(views: [name, spacer, duration, percentage])
            labels.orientation = .horizontal
            labels.alignment = .centerY
            labels.spacing = 8

            let progress = InsightsProgressBar()
            progress.value = project.share
            progress.tintColor = InsightsColors.color(at: index)
            progress.heightAnchor.constraint(equalToConstant: 5).isActive = true

            let row = NSStackView(views: [labels, progress])
            row.orientation = .vertical
            row.alignment = .width
            row.spacing = 4
            allocationStack.addArrangedSubview(row)
        }
    }

    private static func duration(_ milliseconds: Int) -> String {
        let minutes = milliseconds / 60_000
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 { return "\(minutes)m" }
        if remainder == 0 { return "\(hours)h" }
        return "\(hours)h \(remainder)m"
    }

    var windowForTesting: NSWindow { window! }
    var rangeControlForTesting: NSSegmentedControl { rangeControl }
    var customRangeControlsAreHiddenForTesting: Bool { customRangeControls.isHidden }
    var lastRequestedRangeForTesting: InsightsDateRange? { lastRequestedRange }
    var summaryTextForTesting: [String] {
        [focusSummary.stringValue, sessionSummary.stringValue, activeDaySummary.stringValue]
    }
    var projectTitlesForTesting: [String] { projectPopup.itemTitles }
    var chartProjectStacksForTesting: [[String]] {
        chartView.report?.days.map { $0.groups.map(\.project) } ?? []
    }
    var allocationRowsForTesting: [String] { allocationRows }
    var statusMessageForTesting: String? { statusLabel.isHidden ? nil : statusLabel.stringValue }
    func reloadForTesting() async { await reload() }
    func selectRangeForTesting(segment: Int) async {
        rangeControl.selectedSegment = segment
        customRangeControls.isHidden = segment != 3
        await reload()
    }
    func setCustomRangeForTesting(from: Date, to: Date) async {
        rangeControl.selectedSegment = 3
        fromPicker.dateValue = from
        toPicker.dateValue = to
        customRangeControls.isHidden = false
        await reload()
    }
    func selectProjectForTesting(_ project: String) {
        projectPopup.selectItem(withTitle: project)
        projectChanged(projectPopup)
    }
}

private final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}
