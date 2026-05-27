import AppKit
import PmdrMenubarCore

@MainActor
final class FloatingTimerPanelController: NSObject, NSMenuDelegate {
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
    private var projectPopup: NSPopUpButton?
    private var timeField: NSTextField?
    private var dotsField: NSTextField?
    private var controlsRow: NSStackView?
    private var toggleButton: NSButton?
    private var stopButton: NSButton?
    private weak var effectView: FloatingTimerBackgroundView?
    private(set) var isHovered = false
    private var didRefreshProjectPopupDuringHover = false
    private var currentStatus: Status = .idle
    private var toggleSymbolName = "play.fill"
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
        super.init()
    }

    @objc private func closeButtonClicked(_ sender: Any?) {
        hide()
    }

    var panelForTesting: NSPanel? {
        panel
    }

    var snapshotForTesting: Snapshot {
        snapshot
    }

    var trackingAreaForTesting: NSTrackingArea? {
        effectView?.trackingAreas.first
    }

    var visualEffectViewForTesting: NSVisualEffectView? {
        effectView
    }

    var dotsAlphaForTesting: CGFloat {
        dotsField?.alphaValue ?? 0
    }

    var controlsAlphaForTesting: CGFloat {
        controlsRow?.alphaValue ?? 0
    }

    var projectLabelAlphaForTesting: CGFloat {
        projectField?.alphaValue ?? 0
    }

    var projectPopupAlphaForTesting: CGFloat {
        projectPopup?.alphaValue ?? 0
    }

    var isProjectPopupVisibleForTesting: Bool {
        projectPopup?.isHidden == false
    }

    var projectPopupItemTitlesForTesting: [String] {
        projectPopup?.itemTitles ?? []
    }

    var selectedProjectPopupTitleForTesting: String? {
        projectPopup?.titleOfSelectedItem
    }

    var areControlsVisibleForTesting: Bool {
        controlsRow?.isHidden == false
    }

    var toggleButtonTitleForTesting: String? {
        toggleButton?.title
    }

    var toggleButtonSymbolNameForTesting: String {
        toggleSymbolName
    }

    var isStopButtonEnabledForTesting: Bool {
        stopButton?.isEnabled ?? false
    }

    func setHoveredForTesting(_ hovered: Bool) {
        setHovered(hovered)
    }

    func clickToggleButtonForTesting() {
        toggleButtonClicked(toggleButton)
    }

    func clickStopButtonForTesting() {
        stopButtonClicked(stopButton)
    }

    func selectProjectPopupItemForTesting(title: String) {
        projectPopup?.selectItem(withTitle: title)
        projectPopupSelectionChanged(projectPopup)
    }

    func openProjectPopupForTesting() {
        guard let menu = projectPopup?.menu else { return }
        menuWillOpen(menu)
    }

    private func setHovered(_ hovered: Bool) {
        guard isHovered != hovered else { return }
        isHovered = hovered
        if !hovered {
            didRefreshProjectPopupDuringHover = false
        }
        renderHoverState()
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
        refreshProjectPopup()
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
        currentStatus = status
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

    @objc private func toggleButtonClicked(_ sender: Any?) {
        switch currentStatus {
        case .idle:
            startTimer(project: selectedProjectForStarting())
        case .running:
            pauseTimer()
        case .paused:
            resumeTimer()
        }
    }

    @objc private func stopButtonClicked(_ sender: Any?) {
        guard stopButton?.isEnabled == true else { return }
        stopTimer()
    }

    private func selectedProjectForStarting() -> String? {
        if let selected = projectPopup?.titleOfSelectedItem, !selected.isEmpty {
            return selected
        }
        return snapshot.projectName.isEmpty ? nil : snapshot.projectName
    }

    @objc private func projectPopupSelectionChanged(_ sender: Any?) {
        selectProject(projectPopup?.titleOfSelectedItem)
    }

    func menuWillOpen(_ menu: NSMenu) {
        guard menu === projectPopup?.menu, isHovered, !didRefreshProjectPopupDuringHover else { return }
        didRefreshProjectPopupDuringHover = true
        refreshProjectPopup()
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
        renderControls()
        renderHoverState()
    }

    private func refreshProjectPopup() {
        guard let projectPopup else { return }

        let selectedTitle = snapshot.projectName.isEmpty ? projectPopup.titleOfSelectedItem : snapshot.projectName
        let projects = availableProjects().filter { !$0.archived }
        projectPopup.removeAllItems()
        projectPopup.addItems(withTitles: projects.map(\.name))
        if let selectedTitle, !selectedTitle.isEmpty {
            projectPopup.selectItem(withTitle: selectedTitle)
        }
    }

    private func renderControls() {
        switch currentStatus {
        case .idle:
            toggleButton?.title = "Start"
            toggleSymbolName = "play.fill"
            stopButton?.isEnabled = false
        case .running:
            toggleButton?.title = "Pause"
            toggleSymbolName = "pause.fill"
            stopButton?.isEnabled = true
        case .paused:
            toggleButton?.title = "Resume"
            toggleSymbolName = "play.fill"
            stopButton?.isEnabled = true
        }

        toggleButton?.image = NSImage(systemSymbolName: toggleSymbolName, accessibilityDescription: toggleButton?.title)
        toggleButton?.imagePosition = .imageLeading
    }

    private func renderHoverState() {
        let controlsAlpha: CGFloat = isHovered ? 1 : 0
        let dotsAlpha: CGFloat = isHovered ? 0 : 1
        dotsField?.alphaValue = dotsAlpha
        controlsRow?.alphaValue = controlsAlpha
        controlsRow?.isHidden = !isHovered
        dotsField?.isHidden = isHovered
        projectField?.alphaValue = dotsAlpha
        projectPopup?.alphaValue = controlsAlpha
        projectPopup?.isHidden = !isHovered
        projectField?.isHidden = isHovered
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
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        // `.titled` causes NSWindow to inflate the frame by the title bar height
        // when interpreting contentRect; force the frame back to panelSize so the
        // visual footprint and saved per-monitor positions stay consistent.
        panel.setFrame(NSRect(origin: .zero, size: Self.panelSize), display: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        // The slice spec only asks for the close button; defensively hide the
        // others in case a future styleMask change re-adds them.
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        if let closeButton = panel.standardWindowButton(.closeButton) {
            closeButton.target = self
            closeButton.action = #selector(closeButtonClicked(_:))
        }
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

        let trackingArea = NSTrackingArea(
            rect: effect.bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: effect,
            userInfo: nil
        )
        effect.addTrackingArea(trackingArea)
        effect.onHoverChange = { [weak self] hovered in
            self?.setHovered(hovered)
        }

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

        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.controlSize = .small
        popup.font = .systemFont(ofSize: 11, weight: .regular)
        popup.bezelStyle = .texturedRounded
        popup.target = self
        popup.action = #selector(projectPopupSelectionChanged(_:))
        popup.alphaValue = 0
        popup.isHidden = true
        popup.translatesAutoresizingMaskIntoConstraints = false
        popup.menu?.delegate = self

        let projectSlot = NSView()
        projectSlot.translatesAutoresizingMaskIntoConstraints = false
        project.translatesAutoresizingMaskIntoConstraints = false
        projectSlot.addSubview(project)
        projectSlot.addSubview(popup)

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

        let toggle = Self.makeControlButton(title: "Start", target: self, action: #selector(toggleButtonClicked(_:)))
        let stop = Self.makeControlButton(title: "Stop", target: self, action: #selector(stopButtonClicked(_:)))
        if let image = NSImage(systemSymbolName: "stop.fill", accessibilityDescription: "Stop") {
            stop.image = image
            stop.imagePosition = .imageLeading
        }
        let controls = NSStackView(views: [toggle, stop])
        controls.orientation = .horizontal
        controls.alignment = .centerY
        controls.distribution = .gravityAreas
        controls.spacing = 8
        controls.alphaValue = 0
        controls.isHidden = true
        controls.translatesAutoresizingMaskIntoConstraints = false

        let dotsSlot = NSView()
        dotsSlot.translatesAutoresizingMaskIntoConstraints = false
        dots.translatesAutoresizingMaskIntoConstraints = false
        dotsSlot.addSubview(dots)
        dotsSlot.addSubview(controls)

        let stack = NSStackView(views: [phase, projectSlot, time, dotsSlot])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 2
        stack.setCustomSpacing(6, after: projectSlot)
        stack.setCustomSpacing(6, after: time)
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        stack.translatesAutoresizingMaskIntoConstraints = false

        effect.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: effect.centerYAnchor),
            projectSlot.widthAnchor.constraint(equalToConstant: Self.visualSize.width - 24),
            projectSlot.heightAnchor.constraint(equalToConstant: 22),
            project.centerXAnchor.constraint(equalTo: projectSlot.centerXAnchor),
            project.centerYAnchor.constraint(equalTo: projectSlot.centerYAnchor),
            project.widthAnchor.constraint(lessThanOrEqualTo: projectSlot.widthAnchor),
            popup.centerXAnchor.constraint(equalTo: projectSlot.centerXAnchor),
            popup.centerYAnchor.constraint(equalTo: projectSlot.centerYAnchor),
            popup.widthAnchor.constraint(equalTo: projectSlot.widthAnchor),
            dotsSlot.widthAnchor.constraint(equalToConstant: Self.visualSize.width - 24),
            dotsSlot.heightAnchor.constraint(equalToConstant: 24),
            dots.centerXAnchor.constraint(equalTo: dotsSlot.centerXAnchor),
            dots.centerYAnchor.constraint(equalTo: dotsSlot.centerYAnchor),
            controls.centerXAnchor.constraint(equalTo: dotsSlot.centerXAnchor),
            controls.centerYAnchor.constraint(equalTo: dotsSlot.centerYAnchor)
        ])

        contentView.addSubview(effect)
        panel.contentView = contentView

        phaseField = phase
        projectField = project
        projectPopup = popup
        timeField = time
        dotsField = dots
        controlsRow = controls
        toggleButton = toggle
        stopButton = stop
        effectView = effect

        renderControls()
        renderHoverState()

        return panel
    }

    private static func makeControlButton(title: String, target: AnyObject, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: target, action: action)
        button.bezelStyle = .texturedRounded
        button.controlSize = .small
        button.font = .systemFont(ofSize: 11, weight: .medium)
        button.setButtonType(.momentaryPushIn)
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
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
    var onHoverChange: ((Bool) -> Void)?

    override var mouseDownCanMoveWindow: Bool {
        true
    }

    override func mouseEntered(with event: NSEvent) {
        onHoverChange?(true)
    }

    override func mouseExited(with event: NSEvent) {
        onHoverChange?(false)
    }
}

private final class FloatingTimerLabel: NSTextField {
    override var mouseDownCanMoveWindow: Bool {
        true
    }
}
