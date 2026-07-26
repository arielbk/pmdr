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
    private static let visualSize = NSSize(width: 480, height: 46)
    private static let panelSize = surface.panelSize(forVisualSize: visualSize)
    private static let fieldInset: CGFloat = 8

    /// Point size of the leading brand mark. The asset's bottom two units are
    /// padding (see `BrandIcon`), so the fruit reads slightly smaller than this.
    private static let iconSize = NSSize(width: 18, height: 20.25)

    private var panel: NSPanel?
    private var textField: NSTextField?
    private weak var surfaceView: NSVisualEffectView?
    private weak var rowView: NSView?
    private weak var iconView: NSImageView?
    private weak var historyControl: NSButton?
    private weak var historyView: NoteHistoryListView?
    private var historyLoad: Task<Void, Never>?
    private var isHistoryExpanded = false
    private var notes: [NoteRecord]?

    private let onSubmit: (String) -> Void
    private let iconProvider: () -> NSImage?
    private let notesProvider: () async -> [NoteRecord]?
    private let timeFormatter: (Date) -> String
    private let positionStore: CapturePanelPosition
    private let screenProvider: () -> NSScreen?
    private let reduceMotionProvider: () -> Bool

    init(
        onSubmit: @escaping (String) -> Void,
        iconProvider: @escaping () -> NSImage? = { BrandIcon.templateImage(.filled, size: iconSize) },
        notesProvider: @escaping () async -> [NoteRecord]? = { nil },
        timeFormatter: @escaping (Date) -> String = NoteHistory.localizedTime(for:),
        positionStore: CapturePanelPosition = CapturePanelPosition(),
        screenProvider: @escaping () -> NSScreen? = {
            let mouse = NSEvent.mouseLocation
            return NSScreen.screens.first { $0.frame.contains(mouse) }
                ?? NSScreen.main
                ?? NSScreen.screens.first
        },
        reduceMotionProvider: @escaping () -> Bool = {
            NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        }
    ) {
        self.onSubmit = onSubmit
        self.iconProvider = iconProvider
        self.notesProvider = notesProvider
        self.timeFormatter = timeFormatter
        self.positionStore = positionStore
        self.screenProvider = screenProvider
        self.reduceMotionProvider = reduceMotionProvider
        super.init()
    }

    // MARK: - Testing hooks

    var panelForTesting: NSPanel? { panel }
    var textFieldForTesting: NSTextField? { textField }
    var surfaceViewForTesting: NSVisualEffectView? { surfaceView }
    var iconViewForTesting: NSImageView? { iconView }
    var historyControlForTesting: NSButton? { historyControl }
    var historyLoadForTesting: Task<Void, Never>? { historyLoad }
    var isHistoryExpandedForTesting: Bool { isHistoryExpanded }
    var historyViewForTesting: NoteHistoryListView? { historyView }
    var historyRowsForTesting: [NoteHistoryRowView] { historyView?.rows ?? [] }
    var historyPlaceholderForTesting: NSTextField? { historyView?.placeholderLabel }
    var inputRowForTesting: NSView? { rowView }
    private(set) var lastHistoryTransitionForTesting: HistoryTransition?

    /// What the last disclosure change did, so tests can tell the animated
    /// branch from the Reduce Motion one.
    struct HistoryTransition: Equatable {
        let duration: TimeInterval
        let isExpanding: Bool
    }

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
        isHistoryExpanded = false
        // Collapse after positioning: the saved origin belongs to whatever frame
        // was dismissed, and shrinking from a fixed top edge puts the input row
        // back where the user left it.
        updateHistoryPresentation()
        loadHistory()
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
        saveCurrentPosition()
        panel?.orderOut(nil)
    }

    /// Records where the panel currently sits so the next invocation on this
    /// display reopens in the same place. Called on every dismissal, which is
    /// also the only moment a drag can have finished.
    func saveCurrentPosition() {
        guard let panel,
              let screen = screen(containing: panel.frame) ?? screenProvider()
        else {
            return
        }

        positionStore.record(panel.frame.origin, for: screen)
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

    // MARK: - Note history

    /// `Today · N` once the count is known; `Today · —` when `pmdr today --json`
    /// could not be read, so the row never claims a count it does not have.
    static func historyTitle(forCount count: Int?) -> String {
        guard let count else { return "Today · —" }
        return "Today · \(count)"
    }

    /// What VoiceOver announces for the disclosure control. An accessibility
    /// label replaces the button's title, so it has to carry the count itself or
    /// the number of notes is inaudible.
    static func historyAccessibilityLabel(forCount count: Int?) -> String {
        guard let count else { return "Today's notes: count unavailable" }
        return "Today's notes: \(count)"
    }

    /// The disclosure control's chevron: down while collapsed, up once the
    /// history is open. The accessibility description carries the state, so
    /// VoiceOver announces the action and tests can assert it.
    static func historyChevron(expanded: Bool) -> NSImage? {
        NSImage(
            systemSymbolName: expanded ? "chevron.up" : "chevron.down",
            accessibilityDescription: expanded ? "Hide today's notes" : "Show today's notes"
        )
    }

    private func loadHistory() {
        historyLoad?.cancel()
        historyLoad = Task { [weak self] in
            guard let provider = self?.notesProvider else { return }
            let notes = await provider()
            guard !Task.isCancelled else { return }
            self?.apply(notes: notes)
        }
    }

    private func apply(notes: [NoteRecord]?) {
        self.notes = notes
        historyControl?.title = Self.historyTitle(forCount: notes?.count)
        historyControl?.setAccessibilityLabel(Self.historyAccessibilityLabel(forCount: notes?.count))
        historyControl?.isEnabled = notes != nil
        updateHistoryPresentation()
    }

    @objc private func toggleHistory() {
        isHistoryExpanded.toggle()
        updateHistoryPresentation(animated: true)
    }

    /// Duration of the coordinated height-and-fade transition. Restrained on
    /// purpose; overridable so tests can drive both branches deterministically.
    static var historyTransitionDuration: TimeInterval = 0.18

    /// True when the disclosure should animate: the caller asked for it, the
    /// duration is nonzero, and macOS Reduce Motion is off.
    private var shouldAnimateHistory: Bool {
        Self.historyTransitionDuration > 0 && !reduceMotionProvider()
    }

    /// Renders the disclosure state: collapsed is the bare input row, expanded
    /// adds today's notes beneath it and grows the panel downward from its fixed
    /// top edge. Height and opacity move together over the same duration, or
    /// land immediately under Reduce Motion.
    private func updateHistoryPresentation(animated: Bool = false) {
        guard let historyView else { return }

        let duration = animated && shouldAnimateHistory ? Self.historyTransitionDuration : 0
        lastHistoryTransitionForTesting = HistoryTransition(
            duration: duration,
            isExpanding: isHistoryExpanded
        )
        historyControl?.image = Self.historyChevron(expanded: isHistoryExpanded)
        historyControl?.setAccessibilityValue(isHistoryExpanded ? "expanded" : "collapsed")

        if isHistoryExpanded {
            let height = historyView.update(
                notes: notes,
                width: Self.visualSize.width,
                time: timeFormatter
            )
            historyView.isHidden = false
            historyView.alphaValue = duration > 0 ? 0 : 1
            fadeHistory(to: 1, over: duration)
            applyVisualHeight(Self.visualSize.height + height, over: duration)
            // The resize returns once the transition has run, so settling the
            // end state here keeps it independent of the animation.
            historyView.alphaValue = 1
        } else {
            fadeHistory(to: 0, over: duration)
            applyVisualHeight(Self.visualSize.height, over: duration)
            historyView.clear()
            historyView.isHidden = true
            historyView.alphaValue = 1
        }
    }

    /// Starts the history's opacity change. Paired with the panel resize, which
    /// runs over the same duration, so the two read as one transition.
    private func fadeHistory(to alpha: CGFloat, over duration: TimeInterval) {
        guard let historyView else { return }
        guard duration > 0 else {
            historyView.alphaValue = alpha
            return
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            historyView.animator().alphaValue = alpha
        }
    }

    /// Resizes the panel to a visual height, keeping the input row's top edge
    /// where it is so the typing target never moves.
    private func applyVisualHeight(_ height: CGFloat, over duration: TimeInterval = 0) {
        guard let panel else { return }

        let visual = NSSize(width: Self.visualSize.width, height: fittedVisualHeight(height))
        let newPanelSize = Self.surface.panelSize(forVisualSize: visual)
        var frame = panel.frame
        frame.origin.y += frame.height - newPanelSize.height
        frame.size = newPanelSize
        frame = clampedIntoVisibleFrame(frame)
        // `setFrame(_:display:animate:)` rather than `animator()`: the window's
        // own resize animation pumps the run loop and returns with the model
        // frame already final, so the panel's state never depends on an
        // animation having run. `CapturePanel` reports the duration below.
        (panel as? CapturePanel)?.resizeDuration = duration
        panel.setFrame(frame, display: true, animate: duration > 0)
        surfaceView?.frame = Self.surface.surfaceFrame(forVisualSize: visual)
        surfaceView?.layoutSubtreeIfNeeded()
    }

    /// The tallest visual height the active display can show, so a long history
    /// on a short screen is capped (and scrolled) rather than hanging off it.
    private func fittedVisualHeight(_ height: CGFloat) -> CGFloat {
        guard let visible = (screen(containing: panel?.frame ?? .zero) ?? screenProvider())?.visibleFrame else {
            return height
        }

        let available = visible.height - Self.surface.shadowMargin * 2
        return max(Self.visualSize.height, min(height, available))
    }

    /// Nudges `frame` back inside the active display, moving it only as far as
    /// it takes to stay fully visible. Growing history downward from a low
    /// starting point is the case this exists for.
    private func clampedIntoVisibleFrame(_ frame: NSRect) -> NSRect {
        guard let visible = (screen(containing: frame) ?? screenProvider())?.visibleFrame else {
            return frame
        }

        var frame = frame
        if frame.maxY > visible.maxY {
            frame.origin.y = visible.maxY - frame.height
        }
        if frame.minY < visible.minY {
            frame.origin.y = visible.minY
        }
        return frame
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
        panel.isMovableByWindowBackground = true
        // Clear, non-opaque, shadowed: the window server derives the shadow from
        // the surface's visible pixels inside the panel's transparent padding.
        Self.surface.configure(panel)
        panel.delegate = self

        let contentView = NSView(frame: frame)
        contentView.wantsLayer = true
        contentView.autoresizingMask = [.width, .height]

        let effect = CaptureSurfaceView(frame: Self.surface.surfaceFrame(forVisualSize: Self.visualSize))
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

        let history = NSButton(frame: .zero)
        history.translatesAutoresizingMaskIntoConstraints = false
        history.bezelStyle = .inline
        history.isBordered = false
        history.font = .systemFont(ofSize: 12, weight: .medium)
        history.contentTintColor = .secondaryLabelColor
        history.title = Self.historyTitle(forCount: nil)
        history.image = Self.historyChevron(expanded: false)
        history.imagePosition = .imageTrailing
        history.imageHugsTitle = true
        history.target = self
        history.action = #selector(toggleHistory)
        history.setButtonType(.momentaryChange)
        history.setAccessibilityLabel(Self.historyAccessibilityLabel(forCount: nil))

        let icon = CaptureDragHandleImageView(frame: .zero)
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.image = iconProvider()
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.contentTintColor = .labelColor
        // Purely decorative identity: VoiceOver should land on the input, not here.
        icon.setAccessibilityElement(false)

        // The input row is its own view pinned to the surface's top edge, so the
        // history can unfold below it without moving the typing target.
        let row = CaptureBackgroundView(frame: .zero)
        row.translatesAutoresizingMaskIntoConstraints = false

        let notesList = NoteHistoryListView(width: Self.visualSize.width)
        notesList.translatesAutoresizingMaskIntoConstraints = false
        notesList.isHidden = true

        row.addSubview(icon)
        row.addSubview(field)
        row.addSubview(history)
        effect.addSubview(row)
        effect.addSubview(notesList)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: effect.topAnchor),
            row.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            row.heightAnchor.constraint(equalToConstant: Self.visualSize.height),

            icon.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: Self.fieldInset * 1.5),
            icon.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: Self.iconSize.width),
            icon.heightAnchor.constraint(equalToConstant: Self.iconSize.height),

            field.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: Self.fieldInset * 1.25),
            field.trailingAnchor.constraint(equalTo: history.leadingAnchor, constant: -Self.fieldInset),
            field.centerYAnchor.constraint(equalTo: row.centerYAnchor),

            history.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -Self.fieldInset * 1.5),
            history.centerYAnchor.constraint(equalTo: row.centerYAnchor),

            notesList.topAnchor.constraint(equalTo: row.bottomAnchor),
            notesList.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            notesList.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            notesList.bottomAnchor.constraint(equalTo: effect.bottomAnchor)
        ])

        contentView.addSubview(effect)
        panel.contentView = contentView

        // Explicit two-stop key view loop: with Full Keyboard Access on, Tab
        // moves between the input and the disclosure control and back, instead
        // of dead-ending on whatever order AppKit derives from the view tree.
        field.nextKeyView = history
        history.nextKeyView = field
        panel.initialFirstResponder = field

        self.textField = field
        self.surfaceView = effect
        self.rowView = row
        self.iconView = icon
        self.historyControl = history
        self.historyView = notesList

        return panel
    }

    private func position(_ panel: NSPanel, on screen: NSScreen?) {
        guard let screen else { return }

        let origin = positionStore.position(for: screen)
            ?? positionStore.defaultPosition(for: screen, windowSize: Self.panelSize)
        panel.setFrameOrigin(origin)
    }

    private func screen(containing frame: NSRect) -> NSScreen? {
        let center = NSPoint(x: frame.midX, y: frame.midY)
        return NSScreen.screens.first { $0.frame.contains(center) }
    }

    static var defaultPanelSize: NSSize { panelSize }
}

/// Borderless panels are not keyable by default; capture needs key status to
/// accept typed text while floating over another app.
/// The row background is a drag handle: pressing anywhere that is not the
/// input or the history control moves the panel, and because the drag never
/// changes first responder the caret and typed text survive it.
private final class CaptureBackgroundView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
}

private final class CaptureSurfaceView: NSVisualEffectView {
    override var mouseDownCanMoveWindow: Bool { true }
}

/// The brand mark is the panel's deliberate grab point, so it drags too.
private final class CaptureDragHandleImageView: NSImageView {
    override var mouseDownCanMoveWindow: Bool { true }
}

private final class CapturePanel: NSPanel {
    /// Duration the next animated resize should take, so the height change and
    /// the history fade share one timing instead of AppKit's default.
    var resizeDuration: TimeInterval = 0

    override var canBecomeKey: Bool { true }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }

    override func animationResizeTime(_ newFrame: NSRect) -> TimeInterval {
        resizeDuration > 0 ? resizeDuration : super.animationResizeTime(newFrame)
    }
}
