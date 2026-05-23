import Carbon
import Foundation

enum HotkeyManagerError: Error {
    case registrationFailed(OSStatus)
}

struct HotkeyBinding {
    let keyCode: UInt32
    let modifiers: UInt32
    let handler: @MainActor () -> Void

    init(keyCode: UInt32, modifiers: UInt32, handler: @escaping @MainActor () -> Void) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.handler = handler
    }
}

struct HotkeyToken {
    let unregister: () -> Void
}

struct HotkeyEventHandlerToken {
    let remove: () -> Void
}

protocol HotkeyBackend {
    func installEventHandler(
        signature: OSType,
        handler: @escaping @Sendable (UInt32) -> Void
    ) throws -> HotkeyEventHandlerToken
    func registerHotkey(
        keyCode: UInt32,
        modifiers: UInt32,
        signature: OSType,
        id: UInt32
    ) throws -> HotkeyToken
}

final class HotkeyManager {
    private let bindings: [HotkeyBinding]
    private let backend: HotkeyBackend
    private var hotKeyTokens: [HotkeyToken] = []
    private var eventHandlerToken: HotkeyEventHandlerToken?

    init(
        bindings: [HotkeyBinding],
        backend: HotkeyBackend = CarbonHotkeyBackend()
    ) {
        self.bindings = bindings
        self.backend = backend
    }

    deinit {
        hotKeyTokens.forEach { $0.unregister() }
        eventHandlerToken?.remove()
    }

    func register() throws {
        var handlersByID: [UInt32: @MainActor () -> Void] = [:]
        for (index, binding) in bindings.enumerated() {
            handlersByID[UInt32(index + 1)] = binding.handler
        }

        eventHandlerToken = try backend.installEventHandler(signature: Self.signature) { id in
            guard let handler = handlersByID[id] else { return }
            Task { @MainActor in handler() }
        }

        for (index, binding) in bindings.enumerated() {
            let id = UInt32(index + 1)
            let token = try backend.registerHotkey(
                keyCode: binding.keyCode,
                modifiers: binding.modifiers,
                signature: Self.signature,
                id: id
            )
            hotKeyTokens.append(token)
        }
    }

    static let signature: OSType = {
        var result: UInt32 = 0
        for scalar in "PMDR".unicodeScalars {
            result = (result << 8) + UInt32(scalar.value)
        }
        return result
    }()
}

final class CarbonHotkeyBackend: HotkeyBackend {
    func installEventHandler(
        signature: OSType,
        handler: @escaping @Sendable (UInt32) -> Void
    ) throws -> HotkeyEventHandlerToken {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let box = CarbonHotkeyEventHandlerBox(signature: signature, handler: handler)
        var eventHandlerRef: EventHandlerRef?
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let event, let userData else { return OSStatus(eventNotHandledErr) }

                var hotKeyID = EventHotKeyID()
                let parameterStatus = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotKeyID
                )
                let box = Unmanaged<CarbonHotkeyEventHandlerBox>
                    .fromOpaque(userData)
                    .takeUnretainedValue()
                guard parameterStatus == noErr, hotKeyID.signature == box.signature else {
                    return OSStatus(eventNotHandledErr)
                }

                box.handler(hotKeyID.id)
                return noErr
            },
            1,
            &eventType,
            Unmanaged.passUnretained(box).toOpaque(),
            &eventHandlerRef
        )
        guard installStatus == noErr else {
            throw HotkeyManagerError.registrationFailed(installStatus)
        }

        return HotkeyEventHandlerToken {
            if let eventHandlerRef {
                RemoveEventHandler(eventHandlerRef)
            }
            _ = box
        }
    }

    func registerHotkey(
        keyCode: UInt32,
        modifiers: UInt32,
        signature: OSType,
        id: UInt32
    ) throws -> HotkeyToken {
        let hotKeyID = EventHotKeyID(signature: signature, id: id)
        var hotKeyRef: EventHotKeyRef?
        let registerStatus = RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        guard registerStatus == noErr else {
            throw HotkeyManagerError.registrationFailed(registerStatus)
        }

        return HotkeyToken {
            if let hotKeyRef {
                UnregisterEventHotKey(hotKeyRef)
            }
        }
    }
}

private final class CarbonHotkeyEventHandlerBox {
    let signature: OSType
    let handler: @Sendable (UInt32) -> Void

    init(signature: OSType, handler: @escaping @Sendable (UInt32) -> Void) {
        self.signature = signature
        self.handler = handler
    }
}
