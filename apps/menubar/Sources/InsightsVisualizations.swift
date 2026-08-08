import AppKit
import Foundation
import PmdrMenubarCore

enum InsightsColors {
    private static let palette: [NSColor] = [
        .systemRed, .systemBlue, .systemGreen, .systemOrange,
        .systemPurple, .systemTeal, .systemPink, .systemIndigo,
    ]

    static func color(at index: Int) -> NSColor {
        palette[index % palette.count]
    }
}

final class InsightsProgressBar: NSView {
    var value: Double = 0 {
        didSet {
            setAccessibilityValue(value)
            needsDisplay = true
        }
    }
    var tintColor: NSColor = .controlAccentColor {
        didSet { needsDisplay = true }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setAccessibilityElement(true)
        setAccessibilityRole(.progressIndicator)
        setAccessibilityMinValue(0)
        setAccessibilityMaxValue(1)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.quaternaryLabelColor.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        let width = bounds.width * CGFloat(min(1, max(0, value)))
        guard width > 0 else { return }
        tintColor.setFill()
        NSBezierPath(
            roundedRect: NSRect(x: bounds.minX, y: bounds.minY, width: width, height: bounds.height),
            xRadius: bounds.height / 2,
            yRadius: bounds.height / 2
        ).fill()
    }
}

final class InsightsChartView: NSView {
    var report: InsightsReport? {
        didSet {
            setAccessibilityValue(accessibilitySummary)
            needsDisplay = true
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 10
        layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
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
        let barWidth = min(28, max(3, slotWidth * 0.64))
        let projectOrder = report.projects.map(\.project)

        for (dayIndex, day) in report.days.enumerated() {
            let x = plot.minX + CGFloat(dayIndex) * slotWidth + (slotWidth - barWidth) / 2
            var y = plot.minY
            for group in day.groups {
                let height = plot.height * CGFloat(group.totalMs) / CGFloat(maximum)
                color(for: group.project, order: projectOrder).setFill()
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

    private func color(for project: String, order: [String]) -> NSColor {
        let index = order.firstIndex(of: project) ?? 0
        return InsightsColors.color(at: index)
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
