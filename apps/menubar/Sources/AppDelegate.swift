import AppKit
import Foundation
import os.log
import PmdrMenubarCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem?
    private var client: PmdrClient?
    private var poller: StatusPoller?
    private var notifier: PhaseNotifier?
    private var hotkeyManager: HotkeyManager?
    private var pollTask: Task<Void, Never>?
    private var redrawTimer: Timer?
    private var lastStatus: Status = .idle
    private var lastPollAt: Date = .distantPast
    private var projects: [ProjectRecord] = []
    private var didShowBinaryAlert = false
    private var didShowHotkeyAlert = false
    private let log = OSLog(subsystem: "dev.pmdr.menubar", category: "polling")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let environment = LoginShellEnvironment.resolve()
        let client = PmdrClient(environment: environment)
        self.client = client
        poller = StatusPoller(fetcher: client)
        let presenter = UserNotificationsPresenter()
        notifier = PhaseNotifier(presenter: presenter)
        Task { await presenter.requestAuthorization() }

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if let image = NSImage(systemSymbolName: "timer", accessibilityDescription: "pmdr") {
                button.image = image
                button.imagePosition = .imageLeading
                button.title = ""
            } else {
                button.title = "pmdr"
            }
        }

        self.statusItem = item
        rebuildMenu()
        registerHotkey()

        startPolling()
        startRedrawTimer()
        Task { [weak self] in
            try? await self?.refreshFromCLI()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTask?.cancel()
        redrawTimer?.invalidate()
    }

    private func startPolling() {
        guard let poller else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let events = try await poller.pollOnce()
                    let now = Date()
                    let status = await poller.currentStatus() ?? .idle
                    await MainActor.run {
                        self?.lastStatus = status
                        self?.lastPollAt = now
                        self?.updateIcon(for: status)
                        self?.rebuildMenu()
                        self?.redrawTitle()
                    }
                    if let notifier = self?.notifier {
                        await notifier.handle(events)
                    }
                } catch {
                    os_log("Failed to poll pmdr status: %{public}@", log: self?.log ?? .default, type: .error, String(describing: error))
                    await MainActor.run {
                        self?.surfaceClientErrorIfNeeded(error)
                    }
                }
                let cadence = await poller.cadence
                try? await Task.sleep(nanoseconds: UInt64(cadence * 1_000_000_000))
            }
        }
    }

    private func startRedrawTimer() {
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.redrawTitle()
        }
        RunLoop.main.add(timer, forMode: .common)
        redrawTimer = timer
    }

    private func redrawTitle() {
        let elapsed = max(0, Date().timeIntervalSince(lastPollAt))
        statusItem?.button?.title = TitleFormatter.title(
            for: lastStatus,
            elapsedSincePoll: elapsed
        )
    }

    private func updateIcon(for status: Status) {
        guard let button = statusItem?.button else { return }
        let symbolName: String
        switch status {
        case .idle:
            symbolName = "timer"
        case .running:
            symbolName = "timer.circle.fill"
        case .paused:
            symbolName = "pause.circle"
        }
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "pmdr") {
            button.image = image
            button.imagePosition = .imageLeading
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.delegate = self

        switch lastStatus {
        case .idle:
            let startItem = NSMenuItem(title: "Start", action: nil, keyEquivalent: "")
            let submenu = NSMenu()
            if projects.isEmpty {
                let empty = NSMenuItem(title: "No projects", action: nil, keyEquivalent: "")
                empty.isEnabled = false
                submenu.addItem(empty)
            } else {
                for project in projects {
                    let item = NSMenuItem(
                        title: project.name,
                        action: #selector(startProjectFromMenu(_:)),
                        keyEquivalent: ""
                    )
                    item.target = self
                    item.representedObject = project.name
                    submenu.addItem(item)
                }
            }
            submenu.addItem(.separator())
            let newProject = NSMenuItem(
                title: "New project...",
                action: #selector(newProjectFromMenu(_:)),
                keyEquivalent: ""
            )
            newProject.target = self
            submenu.addItem(newProject)
            startItem.submenu = submenu
            menu.addItem(startItem)

        case .running(let active):
            menu.addItem(actionItem("Pause", #selector(pauseFromMenu(_:))))
            menu.addItem(actionItem("Stop", #selector(stopFromMenu(_:))))
            menu.addItem(.separator())
            menu.addItem(projectLabelItem(active.project))

        case .paused(let active):
            menu.addItem(actionItem("Resume", #selector(resumeFromMenu(_:))))
            menu.addItem(actionItem("Stop", #selector(stopFromMenu(_:))))
            menu.addItem(.separator())
            menu.addItem(projectLabelItem(active.project))
        }

        menu.addItem(.separator())
        menu.addItem(NSMenuItem(
            title: "Quit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))
        statusItem?.menu = menu
    }

    private func actionItem(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    private func projectLabelItem(_ project: String?) -> NSMenuItem {
        let item = NSMenuItem(title: "Project: \(project ?? "None")", action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    @objc private func pauseFromMenu(_ sender: NSMenuItem) {
        performClientAction { try await $0.pause() }
    }

    @objc private func resumeFromMenu(_ sender: NSMenuItem) {
        performClientAction { try await $0.resume() }
    }

    @objc private func stopFromMenu(_ sender: NSMenuItem) {
        performClientAction { try await $0.stop() }
    }

    @objc private func startProjectFromMenu(_ sender: NSMenuItem) {
        guard let project = sender.representedObject as? String else { return }
        startProject(project)
    }

    @objc private func newProjectFromMenu(_ sender: NSMenuItem) {
        let alert = NSAlert()
        alert.messageText = "New project"
        alert.informativeText = "Start a focus block for this project."
        alert.addButton(withTitle: "Start")
        alert.addButton(withTitle: "Cancel")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        alert.accessoryView = input

        let response = alert.runModal()
        guard response == .alertFirstButtonReturn else { return }
        let project = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !project.isEmpty else { return }
        startProject(project)
    }

    private func startProject(_ project: String) {
        performClientAction { try await $0.start(project: project) }
    }

    private func performClientAction(_ action: @escaping @Sendable (PmdrClient) async throws -> Void) {
        guard let client else { return }
        Task { [weak self] in
            do {
                try await action(client)
                try await self?.refreshFromCLI()
            } catch {
                os_log("Failed to mutate pmdr state: %{public}@", log: self?.log ?? .default, type: .error, String(describing: error))
                await MainActor.run {
                    self?.surfaceClientErrorIfNeeded(error)
                }
            }
        }
    }

    private func refreshFromCLI() async throws {
        guard let poller else { return }
        let events = try await poller.pollOnce()
        let status = await poller.currentStatus() ?? .idle
        let projects = try await client?.listProjects() ?? []
        let now = Date()
        await MainActor.run {
            self.lastStatus = status
            self.lastPollAt = now
            self.projects = projects
            self.updateIcon(for: status)
            self.rebuildMenu()
            self.redrawTitle()
        }
        await notifier?.handle(events)
    }

    private func registerHotkey() {
        let manager = HotkeyManager { [weak self] in
            self?.handleHotkey()
        }
        do {
            try manager.register()
            hotkeyManager = manager
        } catch {
            os_log("Failed to register global pmdr hotkey: %{public}@", log: log, type: .error, String(describing: error))
            showHotkeyAlertIfNeeded()
        }
    }

    @MainActor
    private func handleHotkey() {
        switch lastStatus {
        case .idle:
            guard let project = lastUsedProject() else {
                statusItem?.button?.performClick(nil)
                return
            }
            startProject(project)
        case .running:
            performClientAction { try await $0.pause() }
        case .paused:
            performClientAction { try await $0.resume() }
        }
    }

    private func lastUsedProject() -> String? {
        let home = client?.environment["HOME"] ?? NSHomeDirectory()
        let url = URL(fileURLWithPath: home)
            .appendingPathComponent(".local/state/pmdr/completions.jsonl")
        guard
            let content = try? String(contentsOf: url, encoding: .utf8),
            let line = content.split(separator: "\n").last,
            let data = String(line).data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let project = object["project"] as? String
        else {
            return nil
        }
        let trimmed = project.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "(unassigned)" {
            return nil
        }
        return trimmed
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
        alert.informativeText = "Another app is already using Ctrl-Option-Command-P."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: NSMenuDelegate

    func menuWillOpen(_ menu: NSMenu) {
        Task { await poller?.setMenuOpen(true) }
        Task { [weak self] in
            try? await self?.refreshFromCLI()
        }
    }

    func menuDidClose(_ menu: NSMenu) {
        Task { await poller?.setMenuOpen(false) }
    }
}
