import AppKit
import PmdrMenubarCore

@MainActor
final class FloatingTimerPanelController {
    struct Snapshot: Equatable {
        var phaseLabel: String
        var projectName: String
        var time: String
        var phaseColor: NSColor
        var isMuted: Bool
        var completedFocusBlocks: Int
    }

    private static let focusGoal = 8
    private static let visualSize = NSSize(width: 240, height: 136)
    private static let shadowMargin: CGFloat = 20
    private static let panelSize = NSSize(
        width: visualSize.width + shadowMargin * 2,
        height: visualSize.height + shadowMargin * 2
    )
    private static let cornerRadius: CGFloat = 14

    private var panel: NSPanel?
    private var phaseField: NSTextField?
    private var projectField: NSTextField?
    private var timeField: NSTextField?
    private var dotsField: NSTextField?
    private var snapshot = Snapshot(
        phaseLabel: "IDLE",
        projectName: "",
        time: "--:--",
        phaseColor: .secondaryLabelColor,
        isMuted: true,
        completedFocusBlocks: 0
    )

    private let positionStore: FloatingTimerPosition
    private let screenProvider: () -> NSScreen?
    private weak var actions: FloatingTimerActions?

    init(
        positionStore: FloatingTimerPosition = FloatingTimerPosition(),
        screenProvider: @escaping () -> NSScreen? = {
            let mouse = NSEvent.mouseLocation
            return NSScreen.screens.first { $0.frame.contains(mouse) }
                ?? NSScreen.main
                ?? NSScreen.screens.first
        },
        actions: FloatingTimerActions? = nil
    ) {
        self.positionStore = positionStore
        self.screenProvider = screenProvider
        self.actions = actions
    }

    var panelForTesting: NSPanel? {
        panel
    }

    var snapshotForTesting: Snapshot {
        snapshot
    }

    func toggle() {
        if panel?.isVisible == true {
            hide()
        } else {
            show()
        }
    }

    func show() {
        let panel = panel ?? makePanel()
        self.panel = panel
        position(panel, on: screenProvider())
        render()
        panel.orderFrontRegardless()
    }

    func hide() {
        saveCurrentPosition()
        panel?.orderOut(nil)
    }

    func saveCurrentPosition() {
        guard let panel,
              let screen = screen(containing: panel.frame) ?? screenProvider()
        else {
            return
        }

        positionStore.record(panel.frame.origin, for: screen)
    }

    func startTimer(project: String?) {
        actions?.start(project: project)
    }

    func pauseTimer() {
        actions?.pause()
    }

    func resumeTimer() {
        actions?.resume()
    }

    func stopTimer() {
        actions?.stop()
    }

    func selectProject(_ project: String?) {
        actions?.setProject(project)
    }

    func availableProjects() -> [ProjectRecord] {
        actions?.listProjects() ?? []
    }

    func update(status: Status, lastProject: String?, elapsedSincePoll: TimeInterval) {
        let viewModel = FloatingTimerViewModel(
            status: status,
            lastProject: lastProject,
            elapsedSincePoll: elapsedSincePoll
        )
        snapshot = Snapshot(
            phaseLabel: viewModel.phaseLabel.uppercased(),
            projectName: viewModel.projectName,
            time: viewModel.time,
            phaseColor: Self.color(for: viewModel.phaseColor),
            isMuted: viewModel.isMuted,
            completedFocusBlocks: viewModel.completedFocusBlocks
        )
        render()
    }

    private func render() {
        phaseField?.stringValue = snapshot.phaseLabel
        phaseField?.textColor = snapshot.isMuted ? .tertiaryLabelColor : .labelColor
        projectField?.stringValue = snapshot.projectName
        projectField?.textColor = .secondaryLabelColor
        timeField?.stringValue = snapshot.time
        timeField?.textColor = snapshot.phaseColor
        dotsField?.attributedStringValue = Self.dotsAttributedString(
            completed: snapshot.completedFocusBlocks,
            isMuted: snapshot.isMuted
        )
    }

    private static func color(for phaseColor: FloatingTimerViewModel.PhaseColor) -> NSColor {
        switch phaseColor {
        case .focus: return .systemRed
        case .break: return .systemGreen
        case .muted: return .secondaryLabelColor
        }
    }

    private static func dotsAttributedString(completed: Int, isMuted: Bool) -> NSAttributedString {
        let filled = min(max(completed, 0), focusGoal)
        let empty = max(0, focusGoal - filled)
        let parts = Array(repeating: "●", count: filled) + Array(repeating: "○", count: empty)
        let joined = parts.joined(separator: " ")
        let attr = NSMutableAttributedString(string: joined)
        let font = NSFont.systemFont(ofSize: 11, weight: .regular)
        attr.addAttribute(.font, value: font, range: NSRange(location: 0, length: attr.length))
        let filledColor: NSColor = isMuted ? NSColor.systemGreen.withAlphaComponent(0.4) : .systemGreen
        let emptyColor: NSColor = .tertiaryLabelColor
        var cursor = 0
        for (index, char) in parts.enumerated() {
            let length = (char as NSString).length
            let color = char == "●" ? filledColor : emptyColor
            attr.addAttribute(.foregroundColor, value: color, range: NSRange(location: cursor, length: length))
            cursor += length
            if index < parts.count - 1 {
                cursor += 1
            }
        }
        return attr
    }

    private func makePanel() -> NSPanel {
        let frame = NSRect(origin: .zero, size: Self.panelSize)
        let panel = FloatingTimerPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        // hasShadow = true lets the window server compute the shadow from visible pixels.
        // The panel is larger than the visual content (shadowMargin padding on each side)
        // so the system sees a rounded inset shape and casts a rounded shadow.
        panel.hasShadow = true

        // Outer clear view fills the enlarged panel frame
        let contentView = NSView(frame: frame)
        contentView.wantsLayer = true
        contentView.autoresizingMask = [.width, .height]

        // Visual content is inset by shadowMargin — transparent corners let the system
        // compute a rounded shadow rather than a rectangular one
        let effectFrame = CGRect(
            x: Self.shadowMargin, y: Self.shadowMargin,
            width: Self.visualSize.width, height: Self.visualSize.height
        )
        let effect = FloatingTimerBackgroundView(frame: effectFrame)
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.appearance = NSAppearance(named: .vibrantDark)
        effect.wantsLayer = true
        effect.layer?.cornerRadius = Self.cornerRadius
        effect.layer?.masksToBounds = true

        let phase = FloatingTimerLabel(labelWithString: snapshot.phaseLabel)
        phase.font = .systemFont(ofSize: 10, weight: .semibold)
        phase.textColor = snapshot.isMuted ? .tertiaryLabelColor : .labelColor
        phase.alignment = .center

        let project = FloatingTimerLabel(labelWithString: snapshot.projectName)
        project.font = .systemFont(ofSize: 11, weight: .regular)
        project.textColor = .secondaryLabelColor
        project.alignment = .center
        project.lineBreakMode = .byTruncatingTail
        project.maximumNumberOfLines = 1

        let time = FloatingTimerLabel(labelWithString: snapshot.time)
        time.font = .monospacedDigitSystemFont(ofSize: 36, weight: .semibold)
        time.textColor = snapshot.phaseColor
        time.alignment = .center

        let dots = FloatingTimerLabel(labelWithString: "")
        dots.alignment = .center
        dots.attributedStringValue = Self.dotsAttributedString(
            completed: snapshot.completedFocusBlocks,
            isMuted: snapshot.isMuted
        )

        let stack = NSStackView(views: [phase, project, time, dots])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 2
        stack.setCustomSpacing(6, after: project)
        stack.setCustomSpacing(6, after: time)
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        stack.translatesAutoresizingMaskIntoConstraints = false

        effect.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: effect.centerYAnchor)
        ])

        contentView.addSubview(effect)
        panel.contentView = contentView

        phaseField = phase
        projectField = project
        timeField = time
        dotsField = dots

        return panel
    }

    private func position(_ panel: NSPanel, on screen: NSScreen?) {
        guard let screen else { return }

        let origin = positionStore.position(for: screen)
            ?? positionStore.defaultPosition(for: screen, windowSize: Self.panelSize)
        panel.setFrameOrigin(origin)
    }

    static var defaultPanelSize: NSSize { panelSize }

    private func screen(containing frame: NSRect) -> NSScreen? {
        let center = NSPoint(x: frame.midX, y: frame.midY)
        return NSScreen.screens.first { $0.frame.contains(center) }
    }
}

private final class FloatingTimerPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

private final class FloatingTimerBackgroundView: NSVisualEffectView {
    override var mouseDownCanMoveWindow: Bool {
        true
    }
}

private final class FloatingTimerLabel: NSTextField {
    override var mouseDownCanMoveWindow: Bool {
        true
    }
}
