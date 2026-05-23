import Carbon
import XCTest

final class HotkeyManagerTests: XCTestCase {
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
