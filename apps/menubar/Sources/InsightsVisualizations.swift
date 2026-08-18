import AppKit
import Foundation
import PmdrMenubarCore

/// A layer-backed surface whose semantic AppKit color follows the view's
/// effective appearance. Converting a dynamic `NSColor` to `CGColor` outside
/// the view's drawing appearance freezes whichever light/dark variant happened
/// to be current at construction time.
class AppearanceAwareBackgroundView: NSView {
    private let semanticBackgroundColor: NSColor

    init(
        frame frameRect: NSRect = .zero,
        backgroundColor: NSColor = .controlBackgroundColor,
        cornerRadius: CGFloat = 0
    ) {
        semanticBackgroundColor = backgroundColor
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = cornerRadius
        refreshBackgroundColor()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refreshBackgroundColor()
    }

    private func refreshBackgroundColor() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = semanticBackgroundColor.cgColor
        }
    }
}

enum InsightsColors {
    private static let palette: [NSColor] = [
        .systemBlue, .systemPurple, .systemTeal, .systemOrange,
        .systemPink, .systemIndigo, .systemGreen, .systemRed,
    ]

    static func color(at index: Int) -> NSColor {
        palette[index % palette.count]
    }

    static func color(for project: String, order: [String]) -> NSColor {
        color(at: order.firstIndex(of: project) ?? 0)
    }
}

final class InsightsDonutChartView: NSView {
    var projects: [InsightsProjectSummary] = [] {
        didSet {
            setAccessibilityValue(accessibilitySummary)
            needsDisplay = true
        }
    }
    var totalText = "0m" {
        didSet { needsDisplay = true }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Project mix")
        setAccessibilityValue("No project data")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private var accessibilitySummary: String {
        guard !projects.isEmpty else { return "No project data" }
        return projects.map {
            "\($0.project) \(Int(($0.share * 100).rounded()))%"
        }.joined(separator: ", ")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let diameter = min(bounds.width, bounds.height) - 20
        guard diameter > 0 else { return }
        let center = NSPoint(x: bounds.midX, y: bounds.midY)
        let radius = diameter / 2
        let lineWidth = max(18, diameter * 0.18)

        let track = NSBezierPath()
        track.appendArc(
            withCenter: center,
            radius: radius - lineWidth / 2,
            startAngle: 0,
            endAngle: 360
        )
        track.lineWidth = lineWidth
        NSColor.quaternaryLabelColor.setStroke()
        track.stroke()

        var startAngle: CGFloat = 90
        for (index, project) in projects.enumerated() {
            let sweep = 360 * CGFloat(project.share)
            guard sweep > 0 else { continue }
            let gap = projects.count > 1 ? min(1.5, sweep * 0.12) : 0
            let segment = NSBezierPath()
            segment.appendArc(
                withCenter: center,
                radius: radius - lineWidth / 2,
                startAngle: startAngle - sweep + gap,
                endAngle: startAngle - gap,
                clockwise: false
            )
            segment.lineWidth = lineWidth
            segment.lineCapStyle = .round
            InsightsColors.color(at: index).setStroke()
            segment.stroke()
            startAngle -= sweep
        }

        drawCentered(totalText, offsetY: 4, font: .systemFont(ofSize: 18, weight: .semibold), color: .labelColor)
        drawCentered("total focus", offsetY: -16, font: .systemFont(ofSize: 11), color: .secondaryLabelColor)
    }

    private func drawCentered(_ text: String, offsetY: CGFloat, font: NSFont, color: NSColor) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
        ]
        let size = text.size(withAttributes: attributes)
        text.draw(
            at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2 + offsetY),
            withAttributes: attributes
        )
    }
}

final class InsightsChartView: AppearanceAwareBackgroundView {
    var projectOrder: [String] = [] {
        didSet { needsDisplay = true }
    }
    var report: InsightsReport? {
        didSet {
            setAccessibilityValue(accessibilitySummary)
            needsDisplay = true
        }
    }

    init(frame frameRect: NSRect) {
        super.init(frame: frameRect, cornerRadius: 10)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Daily focus")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private var accessibilitySummary: String {
        guard let report else { return "No data" }
        return "\(report.days.count) days, \(report.sessionCount) sessions"
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let report, !report.days.isEmpty else {
            drawEmptyState()
            return
        }

        let plot = bounds.insetBy(dx: 12, dy: 28)
        NSColor.separatorColor.setStroke()
        let baseline = NSBezierPath()
        baseline.move(to: NSPoint(x: plot.minX, y: plot.minY))
        baseline.line(to: NSPoint(x: plot.maxX, y: plot.minY))
        baseline.lineWidth = 1
        baseline.stroke()

        let maximum = max(1, report.days.map(\.totalMs).max() ?? 1)
        let slotWidth = plot.width / CGFloat(report.days.count)
        let barWidth = Self.barWidth(forDayCount: report.days.count, in: plot.width)
        for (dayIndex, day) in report.days.enumerated() {
            let x = plot.minX + CGFloat(dayIndex) * slotWidth + (slotWidth - barWidth) / 2
            var y = plot.minY
            for group in day.groups {
                let height = plot.height * CGFloat(group.totalMs) / CGFloat(maximum)
                InsightsColors.color(for: group.project, order: projectOrder).setFill()
                NSBezierPath(
                    roundedRect: NSRect(x: x, y: y, width: barWidth, height: max(1, height)),
                    xRadius: 2,
                    yRadius: 2
                ).fill()
                y += height
            }
        }

        drawDateLabels(report.days, plot: plot, slotWidth: slotWidth)
    }

    static func barWidth(forDayCount dayCount: Int, in plotWidth: CGFloat) -> CGFloat {
        guard dayCount > 0 else { return 0 }
        let slotWidth = plotWidth / CGFloat(dayCount)
        let maximumWidth: CGFloat = dayCount <= 7 ? 48 : 28
        return min(maximumWidth, max(3, slotWidth * 0.64))
    }

    private func drawDateLabels(_ days: [InsightsDay], plot: NSRect, slotWidth: CGFloat) {
        let stride = max(1, Int(ceil(Double(days.count) / 7.0)))
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 9),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        for index in Swift.stride(from: 0, to: days.count, by: stride) {
            let suffix = String(days[index].date.suffix(5)).replacingOccurrences(of: "-", with: "/")
            let size = suffix.size(withAttributes: attributes)
            let center = plot.minX + CGFloat(index) * slotWidth + slotWidth / 2
            suffix.draw(
                at: NSPoint(x: center - size.width / 2, y: bounds.minY + 7),
                withAttributes: attributes
            )
        }
    }

    private func drawEmptyState() {
        let text = "No focus sessions in this range"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        let size = text.size(withAttributes: attributes)
        text.draw(
            at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2),
            withAttributes: attributes
        )
    }
}
