import AppKit
import Foundation
import os.log
import PmdrMenubarCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, FloatingTimerActions {
    private var statusItem: NSStatusItem?
    private var client: PmdrClient?
    private var poller: StatusPoller?
    private var notifier: PhaseNotifier?
    private var hotkeyManager: HotkeyManager?
    private let hotkeySettingsStore = HotkeySettingsStore()
    private var hotkeySettings = HotkeySettings.defaults
    private var floatingTimerPanelController: FloatingTimerPanelController?
    private var capturePanelController: CapturePanelController?
    private var manageProjectsController: ManageProjectsWindowController?
    private var insightsController: InsightsWindowController?
    private var settingsController: SettingsWindowController?
    private var pollTask: Task<Void, Never>?
    private var redrawScheduler: CountdownTickScheduler?
    private var lastStatus: Status = .idle()
    private var stateGeneration: UInt64 = 0
    private var mutationChain: Task<Void, Never>?
    private var projects: [ProjectRecord] = []
    private var currentConfig: PmdrConfig = .defaults
    private var loginItemToggle: LoginItemToggle?
    private var notificationAuthorization: NotificationAuthorization = .granted
    private var didShowBinaryAlert = false
    private var didShowHotkeyAlert = false
    private let log = OSLog(subsystem: "dev.pmdr.menubar", category: "polling")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let environment = LoginShellEnvironment.resolve()
        // Re-derive the login-shell PATH if `pmdr` ever stops resolving: version
        // managers hand out per-shell shim directories that vanish when that
        // shell exits, and the app can outlive the shell it inherited PATH from.
        let client = PmdrClient(
            environment: environment,
            environmentRefresh: { LoginShellEnvironment.resolve() }
        )
        self.client = client
        poller = StatusPoller(fetcher: client)
        let presenter = UserNotificationsPresenter()
        notifier = PhaseNotifier(presenter: presenter, soundPlayer: NSSoundPlayer())
        loginItemToggle = LoginItemToggle(commands: client)
        Task { [weak self] in
            let outcome = await NotificationAuthorization.request(presenter)
            await MainActor.run { self?.applyNotificationAuthorization(outcome) }
        }

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if let image = BrandIcon.templateImage() {
                button.image = image
                button.imagePosition = .imageLeading
                button.title = ""
                button.setAccessibilityLabel("pmdr")
            } else {
                button.title = "pmdr"
            }
        }

        self.statusItem = item
        floatingTimerPanelController = FloatingTimerPanelController(actions: self)
        capturePanelController = CapturePanelController(
            onSubmit: { [weak self] text in
                self?.writeNote(text)
            },
            // nil means "count unavailable" — a failed CLI read must not be shown
            // as zero notes.
            notesProvider: { try? await client.todayNotes() }
        )
        rebuildMenu()
        hotkeySettings = hotkeySettingsStore.load()
        registerHotkeys(hotkeySettings)

        startRedrawScheduler()
        startPolling()
        Task { [weak self] in
            try? await self?.refreshFromCLI()
        }
        Task { [weak self] in
            await self?.refreshLoginItem()
        }

    }

    /// Re-read the LaunchAgent state the CLI owns so Settings reflects the
    /// plist rather than a stale local guess.
    @MainActor
    private func refreshLoginItem() async {
        await loginItemToggle?.refresh()
    }

    @MainActor
    private func applyNotificationAuthorization(_ outcome: NotificationAuthorization) {
        notificationAuthorization = outcome
        if let message = outcome.problemMessage {
            os_log("Notification authorization: %{public}@", log: log, type: .error, message)
        }
        rebuildMenu()
    }

    func applicationWillTerminate(_ notification: Notification) {
        floatingTimerPanelController?.saveCurrentPosition()
        pollTask?.cancel()
        redrawScheduler?.stop()
    }

    private func startPolling() {
        guard let poller else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    let generationAtStart = await MainActor.run { self.stateGeneration }
                    let events = try await poller.pollOnce()
                    let status = await poller.currentStatus() ?? .idle()
                    await MainActor.run {
                        guard self.stateGeneration == generationAtStart else { return }
                        self.lastStatus = status
                        self.updateIcon(for: status)
                        self.rebuildMenu()
                        self.redrawCountdownSurfaces()
                        self.redrawScheduler?.reschedule(for: status)
                    }
                    if let notifier = self.notifier {
                        await notifier.handle(events)
                    }
                } catch {
                    os_log("Failed to poll pmdr status: %{public}@", log: self.log, type: .error, String(describing: error))
                    await MainActor.run {
                        self.surfaceClientErrorIfNeeded(error)
                    }
                }
                let cadence = await poller.cadence
                try? await Task.sleep(nanoseconds: UInt64(cadence * 1_000_000_000))
            }
        }
    }

    private func startRedrawScheduler() {
        let scheduler = CountdownTickScheduler(
            schedule: { delay, action in
                let timer = Timer(timeInterval: delay, repeats: false) { _ in action() }
                RunLoop.main.add(timer, forMode: .common)
                return { timer.invalidate() }
            },
            redraw: { [weak self] in
                MainActor.assumeIsolated {
                    self?.redrawCountdownSurfaces()
                }
            }
        )
        redrawScheduler = scheduler
        scheduler.reschedule(for: lastStatus)
    }

    @MainActor
    private func redrawCountdownSurfaces(at date: Date = Date()) {
        redrawTitle(at: date)
        redrawFloatingTimer(at: date)
    }

    @MainActor
    private func redrawTitle(at date: Date = Date()) {
        statusItem?.button?.attributedTitle = BrandIcon.menuBarTitle(
            TitleFormatter.title(for: lastStatus, at: date)
        )
    }

    private func updateIcon(for status: Status) {
        guard let button = statusItem?.button else { return }
        let style = MenuBarIconStyle(status: status)
        if let image = BrandIcon.templateImage(style.weight) {
            button.image = image
            button.imagePosition = .imageLeading
            button.setAccessibilityLabel(style.accessibilityLabel)
        }
        button.alphaValue = style.isDimmed ? BrandIcon.dimmedAlpha : 1
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.delegate = self

        switch lastStatus {
        case .idle:
            if let last = lastUsedProject() {
                let restart = NSMenuItem(
                    title: "Start \(last)",
                    action: #selector(startLastFromMenu(_:)),
                    keyEquivalent: ""
                )
                restart.target = self
                restart.representedObject = last
                menu.addItem(restart)
            }
            let startItem = NSMenuItem(title: "Start", action: nil, keyEquivalent: "")
            startItem.submenu = projectPickerSubmenu(
                current: nil,
                projectAction: #selector(startProjectFromMenu(_:)),
                noneAction: #selector(startNoneFromMenu(_:)),
                newProjectAction: #selector(newProjectFromMenu(_:))
            )
            menu.addItem(startItem)

        case .running(let active):
            menu.addItem(actionItem("Pause", #selector(pauseFromMenu(_:))))
            menu.addItem(actionItem("Stop", #selector(stopFromMenu(_:))))
            menu.addItem(.separator())
            menu.addItem(changeProjectItem(current: active.project))

        case .paused(let active):
            menu.addItem(actionItem("Resume", #selector(resumeFromMenu(_:))))
            menu.addItem(actionItem("Stop", #selector(stopFromMenu(_:))))
            menu.addItem(.separator())
            menu.addItem(changeProjectItem(current: active.project))
        }

        menu.addItem(.separator())
        menu.addItem(InsightsMenuItem.make(target: self, action: #selector(openInsights(_:))))
        menu.addItem(actionItem("Settings…", #selector(openSettings(_:)), keyEquivalent: ","))
        menu.addItem(actionItem("Manage projects…", #selector(openManageProjects(_:))))
        if let warning = NotificationWarningMenuItem.make(
            for: notificationAuthorization,
            target: self,
            action: #selector(openNotificationSettings(_:))
        ) {
            menu.addItem(.separator())
            menu.addItem(warning)
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(
            title: "Quit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))
        statusItem?.menu = menu
    }

    private func actionItem(
        _ title: String,
        _ action: Selector,
        keyEquivalent: String = ""
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.target = self
        return item
    }

    private func changeProjectItem(current: String?) -> NSMenuItem {
        let item = NSMenuItem(title: "Change project", action: nil, keyEquivalent: "")
        item.submenu = projectPickerSubmenu(
            current: current,
            projectAction: #selector(setProjectFromMenu(_:)),
            noneAction: #selector(setNoneFromMenu(_:)),
            newProjectAction: #selector(newProjectForChangeFromMenu(_:))
        )
        return item
    }

    private func projectPickerSubmenu(
        current: String?,
        projectAction: Selector,
        noneAction: Selector,
        newProjectAction: Selector
    ) -> NSMenu {
        let submenu = NSMenu()
        let visibleProjects = projects.filter { !$0.archived }
        if visibleProjects.isEmpty {
            let empty = NSMenuItem(title: "No projects", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            submenu.addItem(empty)
        } else {
            for project in visibleProjects {
                let item = NSMenuItem(title: project.name, action: projectAction, keyEquivalent: "")
                item.target = self
                item.representedObject = project.name
                if project.name == current {
                    item.state = .on
                }
                submenu.addItem(item)
            }
        }
        submenu.addItem(.separator())
        let noneItem = NSMenuItem(title: "None", action: noneAction, keyEquivalent: "")
        noneItem.target = self
        if current == nil {
            noneItem.state = .on
        }
        submenu.addItem(noneItem)
        let newProject = NSMenuItem(title: "New project...", action: newProjectAction, keyEquivalent: "")
        newProject.target = self
        submenu.addItem(newProject)
        return submenu
    }

    @objc private func pauseFromMenu(_ sender: NSMenuItem) {
        performClientAction(optimistic: optimisticPause()) { try await $0.pause() }
    }

    @objc private func resumeFromMenu(_ sender: NSMenuItem) {
        performClientAction(optimistic: optimisticResume()) { try await $0.resume() }
    }

    @objc private func stopFromMenu(_ sender: NSMenuItem) {
        performClientAction(optimistic: optimisticStop()) { try await $0.stop() }
    }

    @objc private func startProjectFromMenu(_ sender: NSMenuItem) {
        guard let project = sender.representedObject as? String else { return }
        startProject(project)
    }

    @objc private func startLastFromMenu(_ sender: NSMenuItem) {
        guard let project = sender.representedObject as? String else { return }
        startProject(project)
    }

    @objc private func startNoneFromMenu(_ sender: NSMenuItem) {
        performClientAction(optimistic: optimisticStart(project: nil)) {
            try await $0.start(project: nil, forceUnassigned: true)
        }
    }

    @objc private func newProjectFromMenu(_ sender: NSMenuItem) {
        guard let name = promptForNewProjectName(confirmTitle: "Start") else { return }
        startProject(name)
    }

    @objc private func setProjectFromMenu(_ sender: NSMenuItem) {
        guard let project = sender.representedObject as? String else { return }
        performClientAction { try await $0.setProject(project) }
    }

    @objc private func setNoneFromMenu(_ sender: NSMenuItem) {
        performClientAction { try await $0.setProject(nil) }
    }

    @objc private func openManageProjects(_ sender: Any?) {
        guard let client else { return }
        if manageProjectsController == nil {
            manageProjectsController = ManageProjectsWindowController(client: client) { [weak self] projects in
                guard let self else { return }
                self.projects = projects
                self.rebuildMenu()
            }
        }
        manageProjectsController?.show()
    }

    @objc @MainActor private func openInsights(_ sender: Any?) {
        guard let client else { return }
        if insightsController == nil {
            insightsController = InsightsWindowController { range in
                try await client.log(from: range.from, to: range.to)
            }
        }
        insightsController?.show()
    }

    private func writeNote(_ text: String) {
        guard let client else { return }
        Task { [weak self] in
            do {
                try await client.note(text)
            } catch {
                guard let self else { return }
                os_log("Failed to write pmdr note: %{public}@", log: self.log, type: .error, String(describing: error))
                await MainActor.run {
                    self.surfaceClientErrorIfNeeded(error)
                }
            }
        }
    }

    @objc @MainActor private func openSettings(_ sender: Any?) {
        guard let client else { return }
        if settingsController == nil {
            settingsController = SettingsWindowController(
                client: client,
                onSaved: { [weak self] shortcuts in
                    guard let self else { return }
                    self.applyHotkeySettings(shortcuts)
                    Task {
                        try? await self.refreshFromCLI()
                        await self.refreshLoginItem()
                    }
                },
                onShortcutRecordingChanged: { [weak self] isRecording in
                    self?.setHotkeysSuspended(isRecording)
                }
            )
        }
        let fallback = currentConfig
        Task { [weak self] in
            await self?.loginItemToggle?.refresh()
            let config = (try? await client.config()) ?? fallback
            await MainActor.run {
                guard let self else { return }
                self.currentConfig = config
                self.settingsController?.show(
                    config: config,
                    loginItemEnabled: self.loginItemToggle?.isEnabled ?? false,
                    hotkeySettings: self.hotkeySettings
                )
            }
        }
    }

    @objc private func openNotificationSettings(_ sender: NSMenuItem) {
        let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        guard let url else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func newProjectForChangeFromMenu(_ sender: NSMenuItem) {
        guard let name = promptForNewProjectName(confirmTitle: "Switch") else { return }
        performClientAction { try await $0.setProject(name) }
    }

    private func startProject(_ project: String) {
        performClientAction(optimistic: optimisticStart(project: project)) {
            try await $0.start(project: project)
        }
    }

    private func promptForNewProjectName(confirmTitle: String) -> String? {
        let alert = NSAlert()
        alert.messageText = "New project"
        alert.informativeText = "Name the project to attribute this block to."
        alert.addButton(withTitle: confirmTitle)
        alert.addButton(withTitle: "Cancel")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        alert.accessoryView = input

        let response = alert.runModal()
        guard response == .alertFirstButtonReturn else { return nil }
        let trimmed = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func performClientAction(
        optimistic: Status? = nil,
        _ action: @escaping @Sendable (PmdrClient) async throws -> Void
    ) {
        guard let client else { return }
        if let optimistic {
            MainActor.assumeIsolated {
                applyOptimisticStatus(optimistic)
            }
        }
        let hadOptimistic = optimistic != nil
        let previous = mutationChain
        let task = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            do {
                try await action(client)
                try await self.refreshFromCLI()
            } catch {
                os_log("Failed to mutate pmdr state: %{public}@", log: self.log, type: .error, String(describing: error))
                if hadOptimistic {
                    try? await self.refreshFromCLI()
                }
                await MainActor.run {
                    self.surfaceClientErrorIfNeeded(error)
                }
            }
        }
        mutationChain = task
    }

    @MainActor
    private func applyOptimisticStatus(_ status: Status) {
        self.stateGeneration &+= 1
        self.lastStatus = status
        self.updateIcon(for: status)
        self.rebuildMenu()
        self.redrawCountdownSurfaces()
        self.redrawScheduler?.reschedule(for: status)
    }

    private func optimisticPause() -> Status? {
        let nowMs = Int(Date().timeIntervalSince1970 * 1000)
        return OptimisticTimerStatus.pausing(lastStatus, nowMs: nowMs)
    }

    private func optimisticResume() -> Status? {
        let nowMs = Int(Date().timeIntervalSince1970 * 1000)
        return OptimisticTimerStatus.resuming(lastStatus, nowMs: nowMs)
    }

    private func optimisticStop() -> Status? {
        OptimisticTimerStatus.stopping(lastStatus)
    }

    private func optimisticStart(project: String?) -> Status {
        let duration = currentConfig.focusMinutes * 60 * 1_000
        return OptimisticTimerStatus.starting(
            durationMs: duration,
            nowMs: Int(Date().timeIntervalSince1970 * 1000),
            project: project
        )
    }

    private func refreshFromCLI() async throws {
        guard let poller else { return }
        let generationAtStart = await MainActor.run { self.stateGeneration }
        let events = try await poller.pollOnce()
        let status = await poller.currentStatus() ?? .idle()
        let projects = try await client?.listProjects() ?? []
        let config = try await client?.config() ?? .defaults
        let applied = await MainActor.run { () -> Bool in
            guard self.stateGeneration == generationAtStart else { return false }
            self.stateGeneration &+= 1
            self.lastStatus = status
            self.projects = projects
            self.currentConfig = config
            self.floatingTimerPanelController?.configureGoal(dailyGoal: config.dailyGoal, longBreakEvery: config.longBreakEvery)
            self.notifier = self.notifier?.withConfig(config)
            self.updateIcon(for: status)
            self.rebuildMenu()
            self.redrawCountdownSurfaces()
            self.redrawScheduler?.reschedule(for: status)
            return true
        }
        if applied {
            await notifier?.handle(events)
        }
    }

    private func makeHotkeyManager(_ settings: HotkeySettings) -> HotkeyManager {
        let manager = HotkeyManager(bindings: [
            HotkeyBinding(
                keyCode: settings.timer.keyCode,
                modifiers: settings.timer.modifiers,
                handler: { [weak self] in self?.handleTimerHotkey() }
            ),
            HotkeyBinding(
                keyCode: settings.floatingTimer.keyCode,
                modifiers: settings.floatingTimer.modifiers,
                handler: { [weak self] in
                    self?.redrawFloatingTimer()
                    self?.floatingTimerPanelController?.toggle()
                }
            ),
            HotkeyBinding(
                keyCode: settings.captureNote.keyCode,
                modifiers: settings.captureNote.modifiers,
                handler: { [weak self] in self?.capturePanelController?.toggle() }
            )
        ])
        return manager
    }

    @discardableResult
    private func registerHotkeys(_ settings: HotkeySettings, surfaceFailure: Bool = true) -> Bool {
        let manager = makeHotkeyManager(settings)
        do {
            try manager.register()
            hotkeyManager = manager
            return true
        } catch {
            os_log("Failed to register global pmdr hotkey: %{public}@", log: log, type: .error, String(describing: error))
            if surfaceFailure { showHotkeyAlertIfNeeded() }
            return false
        }
    }

    /// Global hotkeys are torn down while a recorder is armed: Carbon eats its
    /// key combination before AppKit sees it, so the currently-bound shortcut
    /// (⌥⌘↩ by default) would fire the timer instead of being recorded.
    @MainActor
    private func setHotkeysSuspended(_ suspended: Bool) {
        if suspended {
            hotkeyManager?.unregisterAll()
        } else {
            _ = registerHotkeys(hotkeySettings, surfaceFailure: false)
        }
    }

    private func applyHotkeySettings(_ settings: HotkeySettings) {
        guard settings != hotkeySettings else { return }
        let previous = hotkeySettings
        hotkeyManager = nil
        if registerHotkeys(settings) {
            hotkeySettings = settings
            hotkeySettingsStore.save(settings)
            didShowHotkeyAlert = false
        } else {
            _ = registerHotkeys(previous, surfaceFailure: false)
        }
    }

    @MainActor
    private func handleTimerHotkey() {
        switch lastStatus {
        case .idle:
            guard let project = lastUsedProject() else {
                statusItem?.button?.performClick(nil)
                return
            }
            startProject(project)
        case .running:
            performClientAction(optimistic: optimisticPause()) { try await $0.pause() }
        case .paused:
            performClientAction(optimistic: optimisticResume()) { try await $0.resume() }
        }
    }

    private func lastUsedProject() -> String? {
        let home = client?.environment["HOME"] ?? NSHomeDirectory()
        let url = URL(fileURLWithPath: home)
            .appendingPathComponent(".local/state/pmdr/last-project.json")
        guard
            let data = try? Data(contentsOf: url),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let project = object["name"] as? String
        else {
            return nil
        }
        let trimmed = project.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "(unassigned)" {
            return nil
        }
        // Skip if the remembered project is archived or missing from the active list.
        if let match = projects.first(where: { $0.name == trimmed }), match.archived {
            return nil
        }
        return trimmed
    }

    @MainActor
    private func redrawFloatingTimer(at date: Date = Date()) {
        floatingTimerPanelController?.update(
            status: lastStatus,
            lastProject: lastUsedProject(),
            at: date
        )
    }

    private func surfaceClientErrorIfNeeded(_ error: Error) {
        if case PmdrClientError.binaryNotFound = error {
            showBinaryAlertIfNeeded()
        }
    }

    private func showBinaryAlertIfNeeded() {
        guard !didShowBinaryAlert else { return }
        didShowBinaryAlert = true
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "pmdr not found"
        alert.informativeText = "Install the CLI and make sure pmdr is available from your login shell PATH."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func showHotkeyAlertIfNeeded() {
        guard !didShowHotkeyAlert else { return }
        didShowHotkeyAlert = true
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Hotkey unavailable"
        alert.informativeText = "One of the configured shortcuts is already used by another app. Choose a different shortcut in Settings."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: FloatingTimerActions

    func start(project: String?) {
        if let project {
            startProject(project)
        } else {
            performClientAction(optimistic: optimisticStart(project: nil)) {
                try await $0.start(project: nil, forceUnassigned: true)
            }
        }
    }

    func pause() {
        performClientAction(optimistic: optimisticPause()) { try await $0.pause() }
    }

    func resume() {
        performClientAction(optimistic: optimisticResume()) { try await $0.resume() }
    }

    func stop() {
        performClientAction(optimistic: optimisticStop()) { try await $0.stop() }
    }

    func setProject(_ project: String?) {
        performClientAction { try await $0.setProject(project) }
    }

    func addProject(_ name: String) {
        performClientAction { try await $0.setProject(name) }
    }

    func listProjects() -> [ProjectRecord] {
        projects.filter { !$0.archived }
    }

    func openSettings() {
        MainActor.assumeIsolated { openSettings(nil) }
    }

    func openInsights() {
        MainActor.assumeIsolated { openInsights(nil) }
    }

    func openManageProjects() {
        MainActor.assumeIsolated { openManageProjects(nil) }
    }

    func quit() {
        NSApp.terminate(nil)
    }

    // MARK: NSMenuDelegate

    func menuWillOpen(_ menu: NSMenu) {
        Task { await poller?.setMenuOpen(true) }
        Task { [weak self] in
            try? await self?.refreshFromCLI()
        }
        // The plist can change from outside the app (`pmdr app login`), so keep
        // the Settings cache fresh whenever the menu is shown.
        Task { [weak self] in
            await self?.refreshLoginItem()
        }
    }

    func menuDidClose(_ menu: NSMenu) {
        Task { await poller?.setMenuOpen(false) }
    }
}

@MainActor
private final class SettingsWindowController: NSObject, NSTextFieldDelegate {
    private static let soundNames = [
        "Basso",
        "Blow",
        "Bottle",
        "Frog",
        "Funk",
        "Glass",
        "Hero",
        "Morse",
        "Ping",
        "Pop",
        "Purr",
        "Sosumi",
        "Submarine",
        "Tink",
    ]

    private let client: PmdrClient
    private let onSaved: (HotkeySettings) -> Void
    private let onShortcutRecordingChanged: (Bool) -> Void
    private let window: NSWindow
    private let focusField = NSTextField()
    private let focusStepper = NSStepper()
    private let shortBreakField = NSTextField()
    private let shortBreakStepper = NSStepper()
    private let longBreakField = NSTextField()
    private let longBreakStepper = NSStepper()
    private let longBreakEveryField = NSTextField()
    private let longBreakEveryStepper = NSStepper()
    private let dailyGoalField = NSTextField()
    private let dailyGoalStepper = NSStepper()
    private let focusSoundPopup = NSPopUpButton()
    private let breakSoundPopup = NSPopUpButton()
    private let launchAtLoginCheckbox = NSButton(
        checkboxWithTitle: LoginItemSetting.title,
        target: nil,
        action: nil
    )
    private let timerShortcutButton = ShortcutRecorderButton(shortcut: HotkeySettings.defaults.timer)
    private let floatingTimerShortcutButton = ShortcutRecorderButton(shortcut: HotkeySettings.defaults.floatingTimer)
    private let captureNoteShortcutButton = ShortcutRecorderButton(shortcut: HotkeySettings.defaults.captureNote)
    private let restoreDefaultsButton = NSButton(title: "Restore Defaults", target: nil, action: nil)
    private let saveButton = NSButton(title: "Save", target: nil, action: nil)
    private let cancelButton = NSButton(title: "Cancel", target: nil, action: nil)
    private var representedConfig = PmdrConfig.defaults
    private var representedLoginItemEnabled = false
    private var representedHotkeySettings = HotkeySettings.defaults

    init(
        client: PmdrClient,
        onSaved: @escaping (HotkeySettings) -> Void,
        onShortcutRecordingChanged: @escaping (Bool) -> Void
    ) {
        self.client = client
        self.onSaved = onSaved
        self.onShortcutRecordingChanged = onShortcutRecordingChanged
        self.window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 350),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        super.init()
        buildWindow()
    }

    func show(
        config: PmdrConfig,
        loginItemEnabled: Bool,
        hotkeySettings: HotkeySettings
    ) {
        representedConfig = config
        representedLoginItemEnabled = loginItemEnabled
        representedHotkeySettings = hotkeySettings
        apply(config)
        apply(loginItemEnabled: loginItemEnabled, hotkeySettings: hotkeySettings)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildWindow() {
        window.title = "Settings"
        window.isReleasedWhenClosed = false

        let content = NSStackView()
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 12
        content.translatesAutoresizingMaskIntoConstraints = false

        let numericPairs: [(NSTextField, NSStepper, Int, Int)] = [
            (focusField, focusStepper, 1, 240),
            (shortBreakField, shortBreakStepper, 1, 60),
            (longBreakField, longBreakStepper, 1, 120),
            (longBreakEveryField, longBreakEveryStepper, 1, 20),
            (dailyGoalField, dailyGoalStepper, 1, 99),
        ]
        for (field, stepper, minVal, maxVal) in numericPairs {
            configureNumericField(field, stepper: stepper, min: minVal, max: maxVal)
        }

        configureSoundPopup(focusSoundPopup)
        configureSoundPopup(breakSoundPopup)
        configureShortcutRecorders()

        content.addArrangedSubview(sectionHeader("General"))
        content.addArrangedSubview(launchAtLoginCheckbox)
        content.addArrangedSubview(sectionDivider())
        content.addArrangedSubview(sectionHeader("Timer"))
        content.addArrangedSubview(row(label: "Focus minutes", control: numericControl(focusField, focusStepper)))
        content.addArrangedSubview(row(label: "Short break minutes", control: numericControl(shortBreakField, shortBreakStepper)))
        content.addArrangedSubview(row(label: "Long break minutes", control: numericControl(longBreakField, longBreakStepper)))
        content.addArrangedSubview(row(label: "Long break cadence", control: numericControl(longBreakEveryField, longBreakEveryStepper)))
        content.addArrangedSubview(row(label: "Daily goal", control: numericControl(dailyGoalField, dailyGoalStepper)))
        content.addArrangedSubview(row(label: "Focus end sound", control: focusSoundPopup))
        content.addArrangedSubview(row(label: "Break end sound", control: breakSoundPopup))
        content.addArrangedSubview(sectionDivider())
        content.addArrangedSubview(sectionHeader("Keyboard Shortcuts"))
        content.addArrangedSubview(row(label: "Timer", control: timerShortcutButton))
        content.addArrangedSubview(row(label: "Floating timer", control: floatingTimerShortcutButton))
        let lastShortcutRow = row(label: "Capture note", control: captureNoteShortcutButton)
        content.addArrangedSubview(lastShortcutRow)

        // The footer applies to the whole window, so it gets its own rule and
        // breathing room rather than reading as part of Keyboard Shortcuts.
        let footerDivider = sectionDivider()
        content.addArrangedSubview(footerDivider)
        content.addArrangedSubview(footerRow())
        content.setCustomSpacing(20, after: lastShortcutRow)
        content.setCustomSpacing(16, after: footerDivider)

        // Use the stack's natural (fitting) size to drive the window height so
        // there is no dead space below the button row.
        let inset: CGFloat = 24
        let stackFit = content.fittingSize
        let contentWidth = window.contentRect(forFrameRect: window.frame).width
        let contentHeight = stackFit.height + inset * 2
        window.setContentSize(NSSize(width: contentWidth, height: contentHeight))

        let root = window.contentView!
        root.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: inset),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -inset),
            content.topAnchor.constraint(equalTo: root.topAnchor, constant: inset),
            content.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -inset),
        ])
    }

    /// Returns a fixed-width container holding a right-aligned text field and an NSStepper.
    /// Total width matches the sound popup buttons (180 pt) so all rows align uniformly.
    private func numericControl(_ field: NSTextField, _ stepper: NSStepper) -> NSView {
        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false
        field.translatesAutoresizingMaskIntoConstraints = false
        stepper.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(field)
        container.addSubview(stepper)

        // Stepper sits on the right; text field fills the remaining space.
        let stepperWidth: CGFloat = 19
        let gap: CGFloat = 4
        let totalWidth: CGFloat = 180

        NSLayoutConstraint.activate([
            container.widthAnchor.constraint(equalToConstant: totalWidth),
            container.heightAnchor.constraint(equalToConstant: 22),

            stepper.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stepper.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stepper.widthAnchor.constraint(equalToConstant: stepperWidth),

            field.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            field.trailingAnchor.constraint(equalTo: stepper.leadingAnchor, constant: -gap),
            field.centerYAnchor.constraint(equalTo: container.centerYAnchor),
        ])
        return container
    }

    private func configureNumericField(_ field: NSTextField, stepper: NSStepper, min: Int, max: Int) {
        let formatter = NumberFormatter()
        formatter.allowsFloats = false
        formatter.minimum = NSNumber(value: min)
        formatter.maximum = NSNumber(value: max)
        formatter.numberStyle = .none
        field.alignment = .right
        field.formatter = formatter
        field.delegate = self

        stepper.minValue = Double(min)
        stepper.maxValue = Double(max)
        stepper.increment = 1
        stepper.valueWraps = false
        stepper.target = self
        stepper.action = #selector(stepperChanged(_:))
        // Tag both views with the same tag so the stepper handler can find the paired field.
        field.tag = ObjectIdentifier(field).hashValue & 0xFFFF
        stepper.tag = field.tag
    }

    @objc private func stepperChanged(_ sender: NSStepper) {
        // Find the text field that shares this stepper's tag and update it.
        for field in [focusField, shortBreakField, longBreakField, longBreakEveryField, dailyGoalField] {
            if field.tag == sender.tag {
                field.integerValue = sender.integerValue
                break
            }
        }
    }

    private func configureSoundPopup(_ popup: NSPopUpButton) {
        popup.removeAllItems()
        popup.addItems(withTitles: Self.soundNames)
        popup.target = self
        popup.action = #selector(playSelectedSound(_:))
        popup.translatesAutoresizingMaskIntoConstraints = false
        popup.widthAnchor.constraint(equalToConstant: 180).isActive = true
    }

    private func configureShortcutRecorders() {
        for recorder in [timerShortcutButton, floatingTimerShortcutButton, captureNoteShortcutButton] {
            recorder.onRecordingChanged = { [weak self] isRecording in
                self?.saveButton.keyEquivalent = isRecording ? "" : "\r"
                self?.onShortcutRecordingChanged(isRecording)
            }
            recorder.widthAnchor.constraint(greaterThanOrEqualToConstant: 92).isActive = true
        }
    }

    private func row(label: String, control: NSView) -> NSStackView {
        let labelView = NSTextField(labelWithString: label)
        labelView.alignment = .right
        labelView.translatesAutoresizingMaskIntoConstraints = false
        labelView.widthAnchor.constraint(equalToConstant: 156).isActive = true

        let stack = NSStackView(views: [labelView, control])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 20
        return stack
    }

    private func sectionDivider() -> NSBox {
        let divider = NSBox()
        divider.boxType = .separator
        divider.translatesAutoresizingMaskIntoConstraints = false
        divider.widthAnchor.constraint(equalToConstant: 372).isActive = true
        return divider
    }

    private func sectionHeader(_ title: String) -> NSTextField {
        let header = NSTextField(labelWithString: title)
        header.font = .systemFont(ofSize: 13, weight: .semibold)
        return header
    }

    /// Resets every section, not just the shortcuts — the button sits in the
    /// window-wide footer, so it restores the window-wide defaults. Nothing is
    /// written until Save.
    @objc private func restoreDefaults(_ sender: NSButton) {
        apply(PmdrConfig.defaults)
        apply(loginItemEnabled: false, hotkeySettings: .defaults)
    }

    private func footerRow() -> NSStackView {
        restoreDefaultsButton.target = self
        restoreDefaultsButton.action = #selector(restoreDefaults(_:))
        restoreDefaultsButton.bezelStyle = .rounded
        restoreDefaultsButton.toolTip = "Reset every setting in this window to its default."

        saveButton.target = self
        saveButton.action = #selector(save(_:))
        saveButton.keyEquivalent = "\r"
        cancelButton.target = self
        cancelButton.action = #selector(cancel(_:))
        cancelButton.keyEquivalent = "\u{1b}"

        let spacer = NSView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let stack = NSStackView(views: [restoreDefaultsButton, spacer, cancelButton, saveButton])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 8
        // Width matches the full content area (window 420pt − 24pt × 2 padding).
        stack.widthAnchor.constraint(equalToConstant: 372).isActive = true
        return stack
    }

    private func apply(_ config: PmdrConfig) {
        focusField.integerValue = config.focusMinutes
        focusStepper.integerValue = config.focusMinutes
        shortBreakField.integerValue = config.shortBreakMinutes
        shortBreakStepper.integerValue = config.shortBreakMinutes
        longBreakField.integerValue = config.longBreakMinutes
        longBreakStepper.integerValue = config.longBreakMinutes
        longBreakEveryField.integerValue = config.longBreakEvery
        longBreakEveryStepper.integerValue = config.longBreakEvery
        dailyGoalField.integerValue = config.dailyGoal
        dailyGoalStepper.integerValue = config.dailyGoal
        selectSound(config.focusEndSound, in: focusSoundPopup)
        selectSound(config.breakEndSound, in: breakSoundPopup)
    }

    private func apply(loginItemEnabled: Bool, hotkeySettings: HotkeySettings) {
        launchAtLoginCheckbox.state = loginItemEnabled ? .on : .off
        timerShortcutButton.setShortcut(hotkeySettings.timer)
        floatingTimerShortcutButton.setShortcut(hotkeySettings.floatingTimer)
        captureNoteShortcutButton.setShortcut(hotkeySettings.captureNote)
    }

    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField else { return }
        // Keep the stepper in sync when the user edits the text field directly.
        let pairs: [(NSTextField, NSStepper)] = [
            (focusField, focusStepper),
            (shortBreakField, shortBreakStepper),
            (longBreakField, longBreakStepper),
            (longBreakEveryField, longBreakEveryStepper),
            (dailyGoalField, dailyGoalStepper),
        ]
        for (f, s) in pairs where f === field {
            s.integerValue = field.integerValue
            break
        }
    }

    func control(
        _ control: NSControl,
        textView: NSTextView,
        doCommandBy commandSelector: Selector
    ) -> Bool {
        guard let field = control as? NSTextField else { return false }
        let pairs: [(NSTextField, NSStepper)] = [
            (focusField, focusStepper),
            (shortBreakField, shortBreakStepper),
            (longBreakField, longBreakStepper),
            (longBreakEveryField, longBreakEveryStepper),
            (dailyGoalField, dailyGoalStepper),
        ]
        guard let (_, stepper) = pairs.first(where: { $0.0 === field }) else { return false }
        let delta: Int
        if commandSelector == #selector(NSResponder.moveUp(_:)) {
            delta = 1
        } else if commandSelector == #selector(NSResponder.moveDown(_:)) {
            delta = -1
        } else {
            return false
        }
        let newValue = min(Int(stepper.maxValue), max(Int(stepper.minValue), field.integerValue + delta))
        field.integerValue = newValue
        stepper.integerValue = newValue
        return true
    }

    private func selectSound(_ sound: String, in popup: NSPopUpButton) {
        if !Self.soundNames.contains(sound) {
            popup.addItem(withTitle: sound)
        }
        popup.selectItem(withTitle: sound)
    }

    @objc private func playSelectedSound(_ sender: NSPopUpButton) {
        guard let sound = sender.titleOfSelectedItem else { return }
        NSSound(named: NSSound.Name(sound))?.play()
    }

    @objc private func cancel(_ sender: NSButton) {
        apply(representedConfig)
        apply(
            loginItemEnabled: representedLoginItemEnabled,
            hotkeySettings: representedHotkeySettings
        )
        window.close()
    }

    @objc private func save(_ sender: NSButton) {
        guard
            focusField.integerValue > 0,
            shortBreakField.integerValue > 0,
            longBreakField.integerValue > 0,
            longBreakEveryField.integerValue > 0,
            dailyGoalField.integerValue > 0,
            let focusSound = focusSoundPopup.titleOfSelectedItem,
            let breakSound = breakSoundPopup.titleOfSelectedItem
        else {
            showValidationAlert()
            return
        }

        let shortcuts = HotkeySettings(
            timer: timerShortcutButton.shortcut,
            floatingTimer: floatingTimerShortcutButton.shortcut,
            captureNote: captureNoteShortcutButton.shortcut
        )
        let shortcutIdentities = shortcuts.all.map { "\($0.keyCode):\($0.modifiers)" }
        guard Set(shortcutIdentities).count == shortcutIdentities.count else {
            showShortcutValidationAlert()
            return
        }

        saveButton.isEnabled = false
        let updates = [
            ("focusMinutes", "\(focusField.integerValue)"),
            ("shortBreakMinutes", "\(shortBreakField.integerValue)"),
            ("longBreakMinutes", "\(longBreakField.integerValue)"),
            ("longBreakEvery", "\(longBreakEveryField.integerValue)"),
            ("dailyGoal", "\(dailyGoalField.integerValue)"),
            ("focusEndSound", focusSound),
            ("breakEndSound", breakSound),
        ]
        let loginItemEnabled = launchAtLoginCheckbox.state == .on
        let loginItemChanged = representedLoginItemEnabled != loginItemEnabled

        Task { [client, onSaved, weak self] in
            do {
                for update in updates {
                    try await client.setConfigValue(key: update.0, value: update.1)
                }
                if loginItemChanged {
                    try await client.setAppLoginItem(enabled: loginItemEnabled)
                }
                await MainActor.run {
                    self?.saveButton.isEnabled = true
                    self?.window.close()
                    onSaved(shortcuts)
                }
            } catch {
                await MainActor.run {
                    self?.saveButton.isEnabled = true
                    self?.showSaveError(error)
                }
            }
        }
    }

    private func showValidationAlert() {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Invalid settings"
        alert.informativeText = "Durations and cadence must be positive whole numbers."
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window)
    }

    private func showShortcutValidationAlert() {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Shortcuts must be unique"
        alert.informativeText = "Choose a different shortcut for each action."
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window)
    }

    private func showSaveError(_ error: Error) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Could not save settings"
        alert.informativeText = String(describing: error)
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window)
    }
}
