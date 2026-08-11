import Carbon
import XCTest

final class HotkeyManagerTests: XCTestCase {
    func testDefaultSettingsMatchTheDocumentedShortcuts() {
        XCTAssertEqual(HotkeySettings.defaults.timer.displayString, "⌥⌘↩")
        XCTAssertEqual(HotkeySettings.defaults.floatingTimer.displayString, "⌃⌥⌘P")
        XCTAssertEqual(HotkeySettings.defaults.captureNote.displayString, "⌃⌥⌘N")
    }

    @MainActor
    func testRecorderCapturesOptionCommandReturnInsteadOfPassingItToTheDefaultButton() throws {
        let initial = HotkeyShortcut(keyCode: UInt32(kVK_ANSI_M), modifiers: UInt32(cmdKey), keyLabel: "M")
        let recorder = ShortcutRecorderButton(shortcut: initial)
        recorder.beginRecording()
        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.option, .command],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "\r",
            charactersIgnoringModifiers: "\r",
            isARepeat: false,
            keyCode: UInt16(kVK_Return)
        ))

        XCTAssertTrue(recorder.performKeyEquivalent(with: event))
        XCTAssertEqual(recorder.shortcut, HotkeySettings.defaults.timer)
    }

    @MainActor
    func testRecorderShowsPressedModifiersBeforeTheFinalKey() throws {
        let recorder = ShortcutRecorderButton(shortcut: HotkeySettings.defaults.timer)
        recorder.beginRecording()
        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.control, .option, .command],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "",
            charactersIgnoringModifiers: "",
            isARepeat: false,
            keyCode: UInt16(kVK_Command)
        ))

        recorder.flagsChanged(with: event)

        XCTAssertEqual(recorder.title, "⌃⌥⌘…")
    }

    func testSettingsStoreRoundTripsCustomizedShortcuts() throws {
        let suite = "HotkeyManagerTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = HotkeySettingsStore(defaults: defaults)
        var settings = HotkeySettings.defaults
        settings.timer = HotkeyShortcut(keyCode: 1, modifiers: UInt32(cmdKey), keyLabel: "S")

        store.save(settings)

        XCTAssertEqual(store.load(), settings)
    }

    func testSettingsStoreFallsBackToDefaultsWhenNothingWasSaved() throws {
        let suite = "HotkeyManagerTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertEqual(HotkeySettingsStore(defaults: defaults).load(), .defaults)
    }

    func testTwoDistinctRegistrationsRouteToTheirOwnCallbacks() async throws {
        let backend = RecordingHotkeyBackend()
        let calls = CallRecorder()
        let timerExpectation = expectation(description: "timer hotkey fires")
        let panelExpectation = expectation(description: "panel hotkey fires")

        let manager = HotkeyManager(
            bindings: [
                HotkeyBinding(
                    keyCode: 36,
                    modifiers: 1 << 11,
                    handler: {
                        calls.append("timer")
                        timerExpectation.fulfill()
                    }
                ),
                HotkeyBinding(
                    keyCode: 35,
                    modifiers: 1 << 12,
                    handler: {
                        calls.append("panel")
                        panelExpectation.fulfill()
                    }
                )
            ],
            backend: backend
        )

        try manager.register()

        XCTAssertEqual(
            backend.registrations,
            [
                RecordingHotkeyBackend.Registration(keyCode: 36, modifiers: 1 << 11, id: 1),
                RecordingHotkeyBackend.Registration(keyCode: 35, modifiers: 1 << 12, id: 2)
            ]
        )

        backend.trigger(id: 1)
        await fulfillment(of: [timerExpectation], timeout: 1)
        XCTAssertEqual(calls.values(), ["timer"])

        backend.trigger(id: 2)
        await fulfillment(of: [panelExpectation], timeout: 1)
        XCTAssertEqual(calls.values(), ["timer", "panel"])
    }
}

private final class RecordingHotkeyBackend: HotkeyBackend {
    struct Registration: Equatable {
        let keyCode: UInt32
        let modifiers: UInt32
        let id: UInt32
    }

    private(set) var registrations: [Registration] = []
    private var handler: (@Sendable (UInt32) -> Void)?

    func installEventHandler(
        signature: OSType,
        handler: @escaping @Sendable (UInt32) -> Void
    ) throws -> HotkeyEventHandlerToken {
        self.handler = handler
        return HotkeyEventHandlerToken(remove: {})
    }

    func registerHotkey(
        keyCode: UInt32,
        modifiers: UInt32,
        signature: OSType,
        id: UInt32
    ) throws -> HotkeyToken {
        registrations.append(Registration(keyCode: keyCode, modifiers: modifiers, id: id))
        return HotkeyToken(unregister: {})
    }

    func trigger(id: UInt32) {
        handler?(id)
    }
}

private final class CallRecorder {
    private let lock = NSLock()
    private var recorded: [String] = []

    func append(_ value: String) {
        lock.lock()
        recorded.append(value)
        lock.unlock()
    }

    func values() -> [String] {
        lock.lock()
        let snapshot = recorded
        lock.unlock()
        return snapshot
    }
}
