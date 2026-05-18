import AppKit
import Foundation
import os.log
import PmdrMenubarCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem?
    private var poller: StatusPoller?
    private var notifier: PhaseNotifier?
    private var pollTask: Task<Void, Never>?
    private var redrawTimer: Timer?
    private var lastStatus: Status = .idle
    private var lastPollAt: Date = .distantPast
    private let log = OSLog(subsystem: "dev.pmdr.menubar", category: "polling")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let environment = LoginShellEnvironment.resolve()
        poller = StatusPoller(fetcher: PmdrClient(environment: environment))
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

        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(
            NSMenuItem(
                title: "Quit",
                action: #selector(NSApplication.terminate(_:)),
                keyEquivalent: "q"
            )
        )
        item.menu = menu

        self.statusItem = item

        startPolling()
        startRedrawTimer()
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
                        self?.redrawTitle()
                    }
                    if let notifier = self?.notifier {
                        await notifier.handle(events)
                    }
                } catch {
                    os_log("Failed to poll pmdr status: %{public}@", log: self?.log ?? .default, type: .error, String(describing: error))
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

    // MARK: NSMenuDelegate

    func menuWillOpen(_ menu: NSMenu) {
        Task { await poller?.setMenuOpen(true) }
    }

    func menuDidClose(_ menu: NSMenu) {
        Task { await poller?.setMenuOpen(false) }
    }
}
