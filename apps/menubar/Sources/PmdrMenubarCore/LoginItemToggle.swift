import Foundation

/// The two login-item operations the app needs from the CLI.
///
/// The LaunchAgent plist is owned entirely by `pmdr app login` — the app never
/// writes it. Abstracted so tests can substitute a recording stub for the real
/// `PmdrClient` without spawning processes.
public protocol LoginItemCommanding: Sendable {
    /// Current state, read back from `pmdr app status --json`.
    func loginItemEnabled() async throws -> Bool
    /// `pmdr app login --enable` / `--disable`.
    func setLoginItemEnabled(_ enabled: Bool) async throws
}

extension PmdrClient: LoginItemCommanding {
    public func loginItemEnabled() async throws -> Bool {
        try await appStatus().loginItem
    }

    public func setLoginItemEnabled(_ enabled: Bool) async throws {
        try await setAppLoginItem(enabled: enabled)
    }
}

/// What a toggle attempt did. `failed` carries a description the caller can put
/// in front of the user — a login toggle that silently does nothing is the
/// failure mode this slice exists to avoid.
public enum LoginItemToggleOutcome: Equatable {
    case updated(Bool)
    case failed(String)
}

/// Cached login-item state for Settings, kept honest by re-reading the CLI.
///
/// Settings needs a value it can read synchronously after refresh;
/// `isEnabled` is that cache. Every mutation goes through the CLI and
/// is then confirmed by a fresh read, so the plist stays the single source of
/// truth even if a write half-succeeds.
@MainActor
public final class LoginItemToggle {
    public private(set) var isEnabled = false

    private let commands: LoginItemCommanding

    public init(commands: LoginItemCommanding) {
        self.commands = commands
    }

    public func refresh() async {
        isEnabled = (try? await commands.loginItemEnabled()) ?? isEnabled
    }

    @discardableResult
    public func toggle() async -> LoginItemToggleOutcome {
        let target = !isEnabled
        do {
            try await commands.setLoginItemEnabled(target)
        } catch {
            // Re-read anyway: the command may have failed after writing.
            await refresh()
            return .failed(Self.describe(error))
        }
        await refresh()
        return .updated(isEnabled)
    }

    private static func describe(_ error: Error) -> String {
        guard case PmdrClientError.nonZeroExit(_, let stderr) = error else {
            return String(describing: error)
        }
        let trimmed = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        // `pmdr app login` fails with exactly one stderr line; prefer it over
        // the raw error dump.
        return trimmed.isEmpty ? String(describing: error) : trimmed
    }
}
