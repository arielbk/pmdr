import AppKit
import PmdrMenubarCore

@MainActor
final class FloatingTimerPanelController {
    private var panel: NSPanel?
    private var renderedText = "00:00 focus -"
    private var renderedTextColor = NSColor.labelColor
    private let positionStore: FloatingTimerPosition
    private let screenProvider: () -> NSScreen?

    init(
        positionStore: FloatingTimerPosition = FloatingTimerPosition(),
        screenProvider: @escaping () -> NSScreen? = { NSScreen.main ?? NSScreen.screens.first }
    ) {
        self.positionStore = positionStore
        self.screenProvider = screenProvider
    }

    var panelForTesting: NSPanel? {
        panel
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

    func update(status: Status, lastProject: String?, elapsedSincePoll: TimeInterval) {
        let viewModel = FloatingTimerViewModel(
            status: status,
            lastProject: lastProject,
            elapsedSincePoll: elapsedSincePoll
        )
        renderedText = "\(viewModel.time) \(viewModel.phaseLabel) \(viewModel.projectName)"
        renderedTextColor = viewModel.isMuted ? .secondaryLabelColor : .labelColor
        render()
    }

    private func render() {
        let label = panel?.contentView as? NSTextField
        label?.stringValue = renderedText
        label?.textColor = renderedTextColor
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 176, height: 48),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = .windowBackgroundColor
        panel.isOpaque = true
        panel.hasShadow = true

        let label = FloatingTimerPanelLabel(labelWithString: renderedText)
        label.frame = panel.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 176, height: 48)
        label.autoresizingMask = [.width, .height]
        label.alignment = .center
        label.font = .monospacedDigitSystemFont(ofSize: 16, weight: .semibold)
        label.textColor = renderedTextColor
        panel.contentView = label

        return panel
    }

    private func position(_ panel: NSPanel, on screen: NSScreen?) {
        guard let screen else { return }

        let origin = positionStore.position(for: screen)
            ?? positionStore.defaultPosition(for: screen, windowSize: panel.frame.size)
        panel.setFrameOrigin(origin)
    }

    private func screen(containing frame: NSRect) -> NSScreen? {
        NSScreen.screens.first { $0.frame.intersects(frame) }
    }
}

private final class FloatingTimerPanelLabel: NSTextField {
    override var mouseDownCanMoveWindow: Bool {
        true
    }
}
