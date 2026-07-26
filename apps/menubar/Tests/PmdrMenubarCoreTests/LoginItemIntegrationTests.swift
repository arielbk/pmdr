import XCTest
@testable import PmdrMenubarCore

/// Drives the *real* `pmdr` CLI, so the JSON contract and the argument spelling
/// are checked across the process boundary rather than only against stubs.
///
/// Skipped unless a `pmdr` on PATH understands `app status --json` — a stale or
/// missing CLI must not fail the suite.
@MainActor
final class LoginItemIntegrationTests: XCTestCase {
    private func makeClient() async throws -> PmdrClient? {
        // A throwaway HOME so the test can never touch the developer's real
        // ~/Library/LaunchAgents.
        let home = FileManager.default.temporaryDirectory
            .appendingPathComponent("pmdr-login-item-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: home) }

        let client = PmdrClient(environment: ["HOME": home.path])
        guard (try? await client.appStatus()) != nil else { return nil }
        return client
    }

    func test_real_cli_reports_no_login_item_in_a_fresh_home() async throws {
        guard let client = try await makeClient() else {
            throw XCTSkip("no pmdr on PATH that understands `app status --json`")
        }
        let status = try await client.appStatus()
        XCTAssertFalse(status.loginItem)
    }

    func test_toggle_surfaces_the_real_clis_refusal_when_the_app_is_not_installed() async throws {
        guard let client = try await makeClient() else {
            throw XCTSkip("no pmdr on PATH that understands `app status --json`")
        }
        let toggle = LoginItemToggle(commands: client)
        await toggle.refresh()

        let outcome = await toggle.toggle()

        guard case .failed(let message) = outcome else {
            return XCTFail("expected the CLI to refuse enabling with no app installed, got \(outcome)")
        }
        XCTAssertTrue(message.contains("pmdr app install"), "got \(message)")
        XCTAssertFalse(toggle.isEnabled)
    }
}
