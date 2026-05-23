import AppKit

@MainActor
final class FloatingTimerPanelController {
    private var panel: NSPanel?

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
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
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

        let label = FloatingTimerPanelLabel(labelWithString: "00:00 focus -")
        label.frame = panel.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 176, height: 48)
        label.autoresizingMask = [.width, .height]
        label.alignment = .center
        label.font = .monospacedDigitSystemFont(ofSize: 16, weight: .semibold)
        label.textColor = .labelColor
        panel.contentView = label

        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(
                x: frame.maxX - panel.frame.width - 24,
                y: frame.maxY - panel.frame.height - 24
            ))
        }

        return panel
    }
}

private final class FloatingTimerPanelLabel: NSTextField {
    override var mouseDownCanMoveWindow: Bool {
        true
    }
}
