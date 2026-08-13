import AppKit
import Carbon
import Foundation

enum HotkeyManagerError: Error {
    case registrationFailed(OSStatus)
}

struct HotkeyShortcut: Codable, Equatable, Hashable {
    let keyCode: UInt32
    let modifiers: UInt32
    let keyLabel: String

    var displayString: String {
        var value = ""
        if modifiers & UInt32(controlKey) != 0 { value += "⌃" }
        if modifiers & UInt32(optionKey) != 0 { value += "⌥" }
        if modifiers & UInt32(shiftKey) != 0 { value += "⇧" }
        if modifiers & UInt32(cmdKey) != 0 { value += "⌘" }
        return value + keyLabel
    }

    static func from(event: NSEvent) -> HotkeyShortcut? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var modifiers: UInt32 = 0
        if flags.contains(.control) { modifiers |= UInt32(controlKey) }
        if flags.contains(.option) { modifiers |= UInt32(optionKey) }
        if flags.contains(.shift) { modifiers |= UInt32(shiftKey) }
        if flags.contains(.command) { modifiers |= UInt32(cmdKey) }
        guard modifiers != 0, let keyLabel = keyLabel(for: event) else { return nil }
        return HotkeyShortcut(
            keyCode: UInt32(event.keyCode),
            modifiers: modifiers,
            keyLabel: keyLabel
        )
    }

    static func modifierDisplayString(for flags: NSEvent.ModifierFlags) -> String {
        let flags = flags.intersection(.deviceIndependentFlagsMask)
        var value = ""
        if flags.contains(.control) { value += "⌃" }
        if flags.contains(.option) { value += "⌥" }
        if flags.contains(.shift) { value += "⇧" }
        if flags.contains(.command) { value += "⌘" }
        return value
    }

    private static func keyLabel(for event: NSEvent) -> String? {
        switch Int(event.keyCode) {
        case kVK_Return: return "↩"
        case kVK_ANSI_KeypadEnter: return "⌤"
        case kVK_Tab: return "⇥"
        case kVK_Space: return "Space"
        case kVK_Delete: return "⌫"
        case kVK_ForwardDelete: return "⌦"
        case kVK_LeftArrow: return "←"
        case kVK_RightArrow: return "→"
        case kVK_UpArrow: return "↑"
        case kVK_DownArrow: return "↓"
        case kVK_Home: return "Home"
        case kVK_End: return "End"
        case kVK_PageUp: return "Page Up"
        case kVK_PageDown: return "Page Down"
        case kVK_F1: return "F1"
        case kVK_F2: return "F2"
        case kVK_F3: return "F3"
        case kVK_F4: return "F4"
        case kVK_F5: return "F5"
        case kVK_F6: return "F6"
        case kVK_F7: return "F7"
        case kVK_F8: return "F8"
        case kVK_F9: return "F9"
        case kVK_F10: return "F10"
        case kVK_F11: return "F11"
        case kVK_F12: return "F12"
        default:
            let value = event.charactersIgnoringModifiers?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .uppercased()
            return value?.isEmpty == false ? value : nil
        }
    }
}

struct HotkeySettings: Codable, Equatable {
    var timer: HotkeyShortcut
    var floatingTimer: HotkeyShortcut
    var captureNote: HotkeyShortcut

    static let defaults = HotkeySettings(
        timer: HotkeyShortcut(
            keyCode: UInt32(kVK_Return),
            modifiers: UInt32(optionKey | cmdKey),
            keyLabel: "↩"
        ),
        floatingTimer: HotkeyShortcut(
            keyCode: UInt32(kVK_ANSI_P),
            modifiers: UInt32(controlKey | optionKey | cmdKey),
            keyLabel: "P"
        ),
        captureNote: HotkeyShortcut(
            keyCode: UInt32(kVK_ANSI_N),
            modifiers: UInt32(controlKey | optionKey | cmdKey),
            keyLabel: "N"
        )
    )

    var all: [HotkeyShortcut] { [timer, floatingTimer, captureNote] }
}

final class HotkeySettingsStore {
    private static let key = "globalHotkeySettings"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> HotkeySettings {
        guard
            let data = defaults.data(forKey: Self.key),
            let settings = try? JSONDecoder().decode(HotkeySettings.self, from: data)
        else {
            return .defaults
        }
        return settings
    }

    func save(_ settings: HotkeySettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: Self.key)
    }
}

final class ShortcutRecorderButton: NSButton {
    private(set) var shortcut: HotkeyShortcut {
        didSet { updateTitle() }
    }
    var onRecordingChanged: ((Bool) -> Void)?
    private var isRecording = false
    private var eventMonitor: Any?

    init(shortcut: HotkeyShortcut) {
        self.shortcut = shortcut
        super.init(frame: .zero)
        bezelStyle = .rounded
        target = self
        action = #selector(toggleRecording(_:))
        setContentHuggingPriority(.required, for: .horizontal)
        updateTitle()
        toolTip = "Click, then press a shortcut that includes a modifier key."
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    deinit {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
        }
    }

    override var acceptsFirstResponder: Bool { true }

    func setShortcut(_ shortcut: HotkeyShortcut) {
        self.shortcut = shortcut
    }

    func beginRecording() {
        setRecording(true)
        window?.makeFirstResponder(self)
    }

    @objc private func toggleRecording(_ sender: NSButton) {
        if isRecording {
            setRecording(false)
            window?.makeFirstResponder(nil)
        } else {
            beginRecording()
        }
    }

    override func keyDown(with event: NSEvent) {
        guard isRecording else {
            super.keyDown(with: event)
            return
        }
        record(event)
    }

    override func flagsChanged(with event: NSEvent) {
        guard isRecording else {
            super.flagsChanged(with: event)
            return
        }
        let modifiers = HotkeyShortcut.modifierDisplayString(for: event.modifierFlags)
        title = modifiers.isEmpty ? "Type shortcut…" : modifiers + "…"
        setAccessibilityLabel("Recording shortcut \(modifiers)")
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard isRecording else { return super.performKeyEquivalent(with: event) }
        record(event)
        return true
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned {
            setRecording(false)
        }
        return resigned
    }

    private func record(_ event: NSEvent) {
        if Int(event.keyCode) == kVK_Escape {
            finishRecording()
            return
        }
        guard let recorded = HotkeyShortcut.from(event: event) else {
            NSSound.beep()
            return
        }
        shortcut = recorded
        finishRecording()
    }

    private func finishRecording() {
        setRecording(false)
        window?.makeFirstResponder(nil)
    }

    /// Local monitors see key events before AppKit's key-equivalent dispatch, so
    /// the window's default button (Return) and any menu equivalent can no longer
    /// swallow a combination the user is trying to record.
    private func startEventMonitor() {
        guard eventMonitor == nil else { return }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { [weak self] event in
            guard let self, self.isRecording, self.window != nil else { return event }
            if event.type == .flagsChanged {
                self.flagsChanged(with: event)
            } else {
                self.record(event)
            }
            return nil
        }
    }

    private func stopEventMonitor() {
        guard let eventMonitor else { return }
        NSEvent.removeMonitor(eventMonitor)
        self.eventMonitor = nil
    }

    private func setRecording(_ recording: Bool) {
        guard recording != isRecording else { return }
        isRecording = recording
        if recording {
            startEventMonitor()
        } else {
            stopEventMonitor()
        }
        if recording {
            title = "Type shortcut…"
            setAccessibilityLabel("Recording shortcut")
        } else {
            updateTitle()
        }
        onRecordingChanged?(recording)
    }

    private func updateTitle() {
        guard !isRecording else { return }
        title = shortcut.displayString
        setAccessibilityLabel("Shortcut \(shortcut.displayString)")
    }
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

    var isRegistered: Bool { eventHandlerToken != nil }

    /// Releases the Carbon registrations. Carbon hotkeys consume their key
    /// combination system-wide before AppKit ever sees it, so an already-bound
    /// combination is impossible to re-record until the binding is torn down.
    func unregisterAll() {
        hotKeyTokens.forEach { $0.unregister() }
        hotKeyTokens = []
        eventHandlerToken?.remove()
        eventHandlerToken = nil
    }

    func register() throws {
        unregisterAll()

        let handlersByID: [UInt32: @MainActor () -> Void] = Dictionary(
            uniqueKeysWithValues: bindings.enumerated().map { index, binding in
                (UInt32(index + 1), binding.handler)
            }
        )

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
