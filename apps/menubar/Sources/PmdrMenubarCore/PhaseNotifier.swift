import AppKit
import Foundation
@preconcurrency import UserNotifications

/// Presents a native banner. Abstracted so tests can substitute a recording stub
/// for `UserNotificationsPresenter` without involving the real notification center.
public protocol NotificationPresenting: Sendable {
    func present(title: String, body: String) async
}

/// Plays a named system sound. Abstracted so tests can inject a recording fake
/// instead of invoking the real `NSSound`.
public protocol SoundPlaying: Sendable {
    func play(named name: String)
}

/// Maps `StatusPoller.Event` sequences to phase-transition banners and sounds.
///
/// Fires exactly two banners (and corresponding sounds), both at most once per
/// transition (the poller's dedup already gives us "once per transition"):
/// - focus → break: "Focus done" / "Break ready" + Glass sound
/// - break → idle: "Break done" + Submarine sound
///
/// Every other event (statusChanged, focus→idle on manual stop, idle→running, etc.)
/// is silently ignored — the spec only calls out these two transitions.
public struct PhaseNotifier: Sendable {
    /// Named constants for the system sounds played at phase transitions.
    public enum SoundName {
        /// Played when the focus block ends and a break becomes pending.
        public static let glass = "Glass"
        /// Played when the break session ends and the timer returns to idle.
        public static let submarine = "Submarine"
    }

    private let presenter: NotificationPresenting
    private let soundPlayer: SoundPlaying?

    public init(presenter: NotificationPresenting, soundPlayer: SoundPlaying? = nil) {
        self.presenter = presenter
        self.soundPlayer = soundPlayer
    }

    public func handle(_ events: [StatusPoller.Event]) async {
        for event in events {
            switch event {
            case .phaseTransition(from: .focus, to: .break):
                soundPlayer?.play(named: SoundName.glass)
                await presenter.present(title: "Focus done", body: "Break ready")
            case .sessionEnded(lastPhase: .break):
                soundPlayer?.play(named: SoundName.submarine)
                await presenter.present(title: "Break done", body: "")
            case .statusChanged, .phaseTransition, .sessionEnded:
                continue
            }
        }
    }
}

/// Production presenter — wraps `UNUserNotificationCenter`. Lives behind the
/// `NotificationPresenting` protocol so unit tests can avoid the framework.
public struct UserNotificationsPresenter: NotificationPresenting {
    private let center: UNUserNotificationCenter

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    /// Ask the user to allow alerts. Safe to call repeatedly — the system
    /// only prompts once per install. The slice is "no settings, no sound
    /// config" so we request only `.alert`.
    public func requestAuthorization() async {
        _ = try? await center.requestAuthorization(options: [.alert])
    }

    public func present(title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }
}

/// Production sound player — looks up named sounds via `NSSound` and plays them
/// on the main thread (AppKit requirement). Lives behind `SoundPlaying` so unit
/// tests can inject a fake without invoking the real audio stack.
public struct NSSoundPlayer: SoundPlaying {
    public init() {}

    public func play(named name: String) {
        DispatchQueue.main.async {
            NSSound(named: name)?.play()
        }
    }
}
