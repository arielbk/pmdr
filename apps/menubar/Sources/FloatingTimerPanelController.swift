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
        var pauseActionLabel: String
    }

    private static let surface = OverlaySurface.standard
    private static let visualSize = NSSize(width: 240, height: 136)
    private static let panelSize = surface.panelSize(forVisualSize: visualSize)
    private static let newProjectTitle = "New Project…"

    private var panel: NSPanel?
    private var phaseField: NSTextField?
    private var projectField: NSTextField?
    private var projectPopup: NSPopUpButton?
    private var timeField: NSTextField?
    private var dotsField: NSTextField?
    private var controlsRow: NSStackView?
    private var toggleButton: NSButton?
    private var stopButton: NSButton?
    private var closeButton: NSButton?
    private weak var effectView: FloatingTimerBackgroundView?
    private(set) var isHovered = false
    private var didRefreshProjectPopupDuringHover = false
    private var currentStatus: Status = .idle()
    private var toggleSymbolName = "play.fill"
    private var snapshot = Snapshot(
        phaseLabel: "IDLE",
        projectName: "",
        time: "--:--",
        phaseColor: .secondaryLabelColor,
        isMuted: true,
        completedFocusBlocks: 0,
        pauseActionLabel: "Pause"
    )

    private var dailyGoal: Int = 8
    private var longBreakEvery: Int = 4

    private let positionStore: FloatingTimerPosition
    private let screenProvider: () -> NSScreen?
    private weak var actions: FloatingTimerActions?
    private let requestNewProjectName: @MainActor () -> String?

    init(
        positionStore: FloatingTimerPosition = FloatingTimerPosition(),
        screenProvider: @escaping () -> NSScreen? = {
            let mouse = NSEvent.mouseLocation
            return NSScreen.screens.first { $0.frame.contains(mouse) }
                ?? NSScreen.main
                ?? NSScreen.screens.first
        },
        actions: FloatingTimerActions? = nil,
        requestNewProjectName: @escaping @MainActor () -> String? = FloatingTimerPanelController.promptForNewProjectName
    ) {
        self.positionStore = positionStore
        self.screenProvider = screenProvider
        self.actions = actions
        self.requestNewProjectName = requestNewProjectName
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

    var surfaceViewForTesting: NSView? {
        effectView
    }

    var dotStringForTesting: String {
        Self.buildDotString(completed: snapshot.completedFocusBlocks, goal: dailyGoal, longBreakEvery: longBreakEvery)
    }

    var dotsAlphaForTesting: CGFloat {
        dotsField?.alphaValue ?? 0
    }

    var controlsAlphaForTesting: CGFloat {
        controlsRow?.alphaValue ?? 0
    }

    var closeButtonAlphaForTesting: CGFloat {
        closeButton?.alphaValue ?? 0
    }

    var closeButtonForTesting: NSButton? {
        closeButton
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

    func addProject(_ name: String) {
        actions?.addProject(name)
    }

    func availableProjects() -> [ProjectRecord] {
        actions?.listProjects() ?? []
    }

    func configureGoal(dailyGoal: Int, longBreakEvery: Int) {
        self.dailyGoal = max(1, dailyGoal)
        self.longBreakEvery = max(1, longBreakEvery)
        render()
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
            completedFocusBlocks: viewModel.completedFocusBlocks,
            pauseActionLabel: viewModel.pauseActionLabel
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
        if let selected = projectPopup?.titleOfSelectedItem,
           !selected.isEmpty,
           selected != Self.newProjectTitle
        {
            return selected
        }
        return snapshot.projectName.isEmpty ? nil : snapshot.projectName
    }

    @objc private func projectPopupSelectionChanged(_ sender: Any?) {
        guard projectPopup?.titleOfSelectedItem == Self.newProjectTitle else {
            selectProject(projectPopup?.titleOfSelectedItem)
            return
        }

        guard let requestedName = requestNewProjectName() else {
            refreshProjectPopup()
            return
        }
        let name = requestedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            refreshProjectPopup()
            return
        }

        if projectPopup?.item(withTitle: name) == nil {
            projectPopup?.insertItem(
                withTitle: name,
                at: max(0, (projectPopup?.numberOfItems ?? 1) - 1)
            )
        }
        projectPopup?.selectItem(withTitle: name)
        addProject(name)
    }

    private static func promptForNewProjectName() -> String? {
        let alert = makeNewProjectAlert()
        guard let input = alert.accessoryView as? NSTextField else { return nil }
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        return input.stringValue
    }

    static func makeNewProjectAlert() -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "New project"
        alert.informativeText = "Name the project to log time against."
        alert.addButton(withTitle: "Log")
        alert.addButton(withTitle: "Cancel")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        alert.accessoryView = input
        return alert
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
        dotsField?.attributedStringValue = dotsAttributedString(
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
        projectPopup.addItem(withTitle: Self.newProjectTitle)
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
            toggleButton?.title = snapshot.pauseActionLabel
            toggleSymbolName = "pause.fill"
            stopButton?.isEnabled = true
        case .paused:
            toggleButton?.title = "Resume"
            toggleSymbolName = "play.fill"
            stopButton?.isEnabled = true
        }

        toggleButton?.image = Self.controlSymbolImage(named: toggleSymbolName, accessibility: toggleButton?.title)
        toggleButton?.imagePosition = .imageLeading
    }

    private func renderHoverState() {
        let controlsAlpha: CGFloat = isHovered ? 1 : 0
        let dotsAlpha: CGFloat = isHovered ? 0 : 1
        fadeAlpha(of: dotsField, to: dotsAlpha)
        fadeAlpha(of: controlsRow, to: controlsAlpha)
        fadeAlpha(of: projectField, to: dotsAlpha)
        fadeAlpha(of: projectPopup, to: controlsAlpha)
        fadeAlpha(of: closeButton, to: controlsAlpha)
        controlsRow?.isHidden = !isHovered
        dotsField?.isHidden = isHovered
        projectPopup?.isHidden = !isHovered
        projectField?.isHidden = isHovered
        closeButton?.isHidden = !isHovered
    }

    private func fadeAlpha(of view: NSView?, to target: CGFloat) {
        guard let view else { return }
        let previous = view.alphaValue
        view.alphaValue = target
        guard previous != target,
              Self.hoverTransitionDuration > 0,
              let layer = view.layer
        else { return }
        let anim = CABasicAnimation(keyPath: "opacity")
        anim.fromValue = Float(previous)
        anim.toValue = Float(target)
        anim.duration = Self.hoverTransitionDuration
        anim.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(anim, forKey: "hoverFade")
    }

    static var hoverTransitionDuration: TimeInterval = 0.12

    private static func color(for phaseColor: FloatingTimerViewModel.PhaseColor) -> NSColor {
        switch phaseColor {
        case .focus: return .systemRed
        case .break: return .systemGreen
        case .muted: return .secondaryLabelColor
        }
    }

    /// Builds a dot string for the given completion count, goal, and long-break cadence.
    /// Dots within a group are separated by a thin space (U+2009); groups are separated by two regular spaces.
    static func buildDotString(completed: Int, goal: Int, longBreakEvery: Int) -> String {
        let filled = min(max(completed, 0), goal)
        let thinSpace = "\u{2009}"
        var result = ""
        for i in 0 ..< goal {
            let isGroupBoundary = longBreakEvery > 0 && i > 0 && i % longBreakEvery == 0
            if isGroupBoundary {
                result += "  "
            } else if i > 0 {
                result += thinSpace
            }
            result += i < filled ? "●" : "○"
        }
        return result
    }

    private func dotsAttributedString(completed: Int, isMuted: Bool) -> NSAttributedString {
        let dotString = Self.buildDotString(completed: completed, goal: dailyGoal, longBreakEvery: longBreakEvery)
        let attr = NSMutableAttributedString(string: dotString)
        let font = NSFont.systemFont(ofSize: 11, weight: .regular)
        attr.addAttribute(.font, value: font, range: NSRange(location: 0, length: attr.length))
        let filledColor: NSColor = isMuted ? NSColor.systemGreen.withAlphaComponent(0.4) : .systemGreen
        let emptyColor: NSColor = .tertiaryLabelColor
        var cursor = 0
        for char in dotString.unicodeScalars {
            let scalar = char
            if scalar == "●" {
                attr.addAttribute(.foregroundColor, value: filledColor, range: NSRange(location: cursor, length: 1))
                cursor += 1
            } else if scalar == "○" {
                attr.addAttribute(.foregroundColor, value: emptyColor, range: NSRange(location: cursor, length: 1))
                cursor += 1
            } else {
                // space character(s)
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
        // Clear, non-opaque, shadowed: the window server computes the shadow from
        // the surface's visible pixels, which the surface pads on every side so
        // the shadow comes out rounded rather than rectangular.
        Self.surface.configure(panel)

        // Outer clear view fills the enlarged panel frame
        let contentView = NSView(frame: frame)
        contentView.wantsLayer = true
        contentView.autoresizingMask = [.width, .height]

        let effect = FloatingTimerBackgroundView(frame: Self.surface.surfaceFrame(forVisualSize: Self.visualSize))
        Self.surface.apply(to: effect)

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
        popup.contentTintColor = .secondaryLabelColor
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
        dots.attributedStringValue = dotsAttributedString(
            completed: snapshot.completedFocusBlocks,
            isMuted: snapshot.isMuted
        )

        let toggle = Self.makeControlButton(title: "Start", target: self, action: #selector(toggleButtonClicked(_:)))
        let stop = Self.makeControlButton(title: "Stop", target: self, action: #selector(stopButtonClicked(_:)))
        if let image = Self.controlSymbolImage(named: "stop.fill", accessibility: "Stop") {
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

        let close = Self.makeCloseButton(target: self, action: #selector(closeButtonClicked(_:)))
        close.alphaValue = 0
        close.isHidden = true

        effect.addSubview(stack)
        effect.addSubview(close)
        NSLayoutConstraint.activate([
            close.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 8),
            close.topAnchor.constraint(equalTo: effect.topAnchor, constant: 8),
            close.widthAnchor.constraint(equalToConstant: 14),
            close.heightAnchor.constraint(equalToConstant: 14)
        ])
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
            popup.widthAnchor.constraint(lessThanOrEqualTo: projectSlot.widthAnchor),
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
        closeButton = close
        effectView = effect

        renderControls()
        renderHoverState()

        return panel
    }

    private static func makeCloseButton(target: AnyObject, action: Selector) -> NSButton {
        let button = NSButton()
        button.translatesAutoresizingMaskIntoConstraints = false
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.title = ""
        if let image = NSImage(systemSymbolName: "xmark.circle.fill", accessibilityDescription: "Close") {
            let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
            button.image = image.withSymbolConfiguration(config)
        }
        button.imagePosition = .imageOnly
        button.contentTintColor = .tertiaryLabelColor
        button.target = target
        button.action = action
        button.toolTip = "Hide timer"
        return button
    }

    private static func controlSymbolImage(named name: String, accessibility: String?) -> NSImage? {
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: accessibility) else {
            return nil
        }
        let palette = NSImage.SymbolConfiguration(paletteColors: [.secondaryLabelColor])
        return image.withSymbolConfiguration(palette) ?? image
    }

    private static func makeControlButton(title: String, target: AnyObject, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: target, action: action)
        button.bezelStyle = .texturedRounded
        button.controlSize = .small
        button.font = .systemFont(ofSize: 11, weight: .medium)
        button.setButtonType(.momentaryPushIn)
        button.contentTintColor = .secondaryLabelColor
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
