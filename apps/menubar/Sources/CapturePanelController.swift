import AppKit
import PmdrMenubarCore

/// Borderless, always-on-top capture panel with a single text field.
///
/// Pressing Enter hands the field's text to `onSubmit` (the app shells out to
/// `pmdr note <text>`) and dismisses the panel. Escape, or the panel losing key
/// focus, cancels without submitting. The panel is keyable so it can accept text
/// input when summoned over another app, and joins all spaces so it can be
/// summoned from anywhere.
@MainActor
final class CapturePanelController: NSObject, NSTextFieldDelegate, NSWindowDelegate {
    private static let surface = OverlaySurface.standard
    private static let visualSize = NSSize(width: 380, height: 46)
    private static let panelSize = surface.panelSize(forVisualSize: visualSize)
    private static let fieldInset: CGFloat = 8

    private var panel: NSPanel?
    private var textField: NSTextField?
    private weak var surfaceView: NSView?

    private let onSubmit: (String) -> Void
    private let screenProvider: () -> NSScreen?

    init(
        onSubmit: @escaping (String) -> Void,
        screenProvider: @escaping () -> NSScreen? = {
            let mouse = NSEvent.mouseLocation
            return NSScreen.screens.first { $0.frame.contains(mouse) }
                ?? NSScreen.main
                ?? NSScreen.screens.first
        }
    ) {
        self.onSubmit = onSubmit
        self.screenProvider = screenProvider
        super.init()
    }

    // MARK: - Testing hooks

    var panelForTesting: NSPanel? { panel }
    var textFieldForTesting: NSTextField? { textField }
    var surfaceViewForTesting: NSView? { surfaceView }

    /// Drives the real field-editor command dispatch used by Enter/Escape, so
    /// tests exercise the same path AppKit takes for those keys.
    @discardableResult
    func sendCommandForTesting(_ selector: Selector) -> Bool {
        guard let field = textField else { return false }
        return control(field, textView: NSTextView(), doCommandBy: selector)
    }

    func resignKeyForTesting() {
        windowDidResignKey(Notification(name: NSWindow.didResignKeyNotification))
    }

    // MARK: - Presentation

    func toggle() {
        if panel?.isVisible == true {
            cancel()
        } else {
            show()
        }
    }

    func show() {
        let panel = panel ?? makePanel()
        self.panel = panel
        let wasVisible = panel.isVisible
        position(panel, on: screenProvider())
        textField?.stringValue = ""
        NSApp.activate(ignoringOtherApps: true)
        if !wasVisible {
            panel.alphaValue = Self.showTransitionDuration > 0 ? 0 : 1
        }
        panel.makeKeyAndOrderFront(nil)
        if let textField {
            panel.makeFirstResponder(textField)
        }
        if !wasVisible, Self.showTransitionDuration > 0 {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = Self.showTransitionDuration
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                panel.animator().alphaValue = 1
            }
        }
    }

    static var showTransitionDuration: TimeInterval = 0.12

    func hide() {
        panel?.orderOut(nil)
    }

    // MARK: - Actions

    private func submit() {
        let text = textField?.stringValue ?? ""
        hide()
        onSubmit(text)
    }

    private func cancel() {
        hide()
    }

    // MARK: - NSTextFieldDelegate

    func control(
        _ control: NSControl,
        textView: NSTextView,
        doCommandBy commandSelector: Selector
    ) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            submit()
            return true
        }
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            cancel()
            return true
        }
        return false
    }

    // MARK: - NSWindowDelegate

    func windowDidResignKey(_ notification: Notification) {
        guard panel?.isVisible == true else { return }
        cancel()
    }

    // MARK: - Panel construction

    private func makePanel() -> NSPanel {
        let frame = NSRect(origin: .zero, size: Self.panelSize)
        let panel = CapturePanel(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        // Clear, non-opaque, shadowed: the window server derives the shadow from
        // the surface's visible pixels inside the panel's transparent padding.
        Self.surface.configure(panel)
        panel.delegate = self

        let contentView = NSView(frame: frame)
        contentView.wantsLayer = true
        contentView.autoresizingMask = [.width, .height]

        let effect = NSView(frame: Self.surface.surfaceFrame(forVisualSize: Self.visualSize))
        Self.surface.apply(to: effect)
        effect.autoresizingMask = [.width, .height]

        let field = NSTextField(frame: .zero)
        field.translatesAutoresizingMaskIntoConstraints = false
        field.placeholderString = "Add a pmdr note…"
        field.isBordered = false
        field.drawsBackground = false
        field.bezelStyle = .roundedBezel
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 15, weight: .regular)
        field.textColor = .labelColor
        field.lineBreakMode = .byTruncatingTail
        field.usesSingleLineMode = true
        field.delegate = self

        effect.addSubview(field)
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: Self.fieldInset * 2),
            field.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -Self.fieldInset * 2),
            field.centerYAnchor.constraint(equalTo: effect.centerYAnchor)
        ])

        contentView.addSubview(effect)
        panel.contentView = contentView

        self.textField = field
        self.surfaceView = effect

        return panel
    }

    private func position(_ panel: NSPanel, on screen: NSScreen?) {
        guard let screen else { return }
        let visible = screen.visibleFrame
        let size = Self.panelSize
        let origin = NSPoint(
            x: visible.midX - size.width / 2,
            y: visible.midY + visible.height / 6
        )
        panel.setFrameOrigin(origin)
    }

    static var defaultPanelSize: NSSize { panelSize }
}

/// Borderless panels are not keyable by default; capture needs key status to
/// accept typed text while floating over another app.
private final class CapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}
