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

/// Asks the user for permission to post banners. Abstracted so tests can drive
/// the outcome without the real notification centre (which needs a signed,
/// launched app bundle and cannot run under `xctest`).
public protocol NotificationAuthorizing: Sendable {
    /// `true` when the user allowed alerts.
    func requestAuthorization() async throws -> Bool
}

/// The result of asking for notification permission.
///
/// The app's whole job is telling you when a block ends, so a request that was
/// denied — or that failed outright — has to be surfaced rather than dropped.
public enum NotificationAuthorization: Equatable {
    case granted
    case denied
    case failed(String)

    /// What to tell the user, or `nil` when there is nothing to say.
    public var problemMessage: String? {
        switch self {
        case .granted:
            return nil
        case .denied:
            return "pmdr can't post phase notifications. Turn them on in "
                + "System Settings → Notifications → pmdr."
        case .failed(let description):
            return "pmdr could not ask for notification permission: \(description)"
        }
    }

    public static func request(_ authorizer: NotificationAuthorizing) async -> NotificationAuthorization {
        do {
            return try await authorizer.requestAuthorization() ? .granted : .denied
        } catch {
            return .failed(String(describing: error))
        }
    }
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
    private let config: PmdrConfig

    public init(
        presenter: NotificationPresenting,
        soundPlayer: SoundPlaying? = nil,
        config: PmdrConfig = .defaults
    ) {
        self.presenter = presenter
        self.soundPlayer = soundPlayer
        self.config = config
    }

    public func withConfig(_ config: PmdrConfig) -> PhaseNotifier {
        PhaseNotifier(presenter: presenter, soundPlayer: soundPlayer, config: config)
    }

    public func handle(_ events: [StatusPoller.Event]) async {
        for event in events {
            switch event {
            case .phaseTransition(from: .focus, to: .break):
                soundPlayer?.play(named: config.focusEndSound)
                await presenter.present(title: "Focus done", body: "Break ready")
            case .sessionEnded(lastPhase: .break):
                soundPlayer?.play(named: config.breakEndSound)
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

extension UserNotificationsPresenter: NotificationAuthorizing {
    /// Ask the user to allow alerts. Safe to call repeatedly — the system only
    /// prompts once per install, and afterwards returns the standing answer.
    /// The result is returned rather than discarded: an app that cannot notify
    /// has to say so. We request only `.alert`.
    public func requestAuthorization() async throws -> Bool {
        try await center.requestAuthorization(options: [.alert])
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
