import Foundation
import UserNotifications

/// Presents a native banner. Abstracted so tests can substitute a recording stub
/// for `UserNotificationsPresenter` without involving the real notification center.
public protocol NotificationPresenting: Sendable {
    func present(title: String, body: String) async
}

/// Maps `StatusPoller.Event` sequences to phase-transition banners.
///
/// Fires exactly two banners, both at most once per transition (the poller's
/// dedup already gives us "once per transition"):
/// - focus → break: "Focus done" / "Break started"
/// - break → idle: "Break done"
///
/// Every other event (statusChanged, focus→idle on manual stop, idle→running, etc.)
/// is silently ignored — the spec only calls out these two transitions.
public struct PhaseNotifier: Sendable {
    private let presenter: NotificationPresenting

    public init(presenter: NotificationPresenting) {
        self.presenter = presenter
    }

    public func handle(_ events: [StatusPoller.Event]) async {
        for event in events {
            switch event {
            case .phaseTransition(from: .focus, to: .break):
                await presenter.present(title: "Focus done", body: "Break started")
            case .sessionEnded(lastPhase: .break):
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
