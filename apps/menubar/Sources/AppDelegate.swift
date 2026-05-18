import AppKit
import Foundation
import PmdrMenubarCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem?
    private let poller = StatusPoller(fetcher: PmdrClient())
    private var pollTask: Task<Void, Never>?
    private var redrawTimer: Timer?
    private var lastStatus: Status = .idle
    private var lastPollAt: Date = .distantPast

    func applicationDidFinishLaunching(_ notification: Notification) {
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
        let poller = self.poller
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    _ = try await poller.pollOnce()
                    let now = Date()
                    let status = await poller.currentStatus() ?? .idle
                    await MainActor.run {
                        self?.lastStatus = status
                        self?.lastPollAt = now
                        self?.redrawTitle()
                    }
                } catch {
                    // Errors are non-fatal for the title — future slices surface them.
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
        Task { await poller.setMenuOpen(true) }
    }

    func menuDidClose(_ menu: NSMenu) {
        Task { await poller.setMenuOpen(false) }
    }
}
