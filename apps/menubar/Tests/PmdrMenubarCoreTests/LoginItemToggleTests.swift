import XCTest
@testable import PmdrMenubarCore

/// Stands in for the CLI. Records every write so tests can assert that the
/// toggle shells out rather than managing the LaunchAgent plist itself.
private final class RecordingLoginItemCommands: LoginItemCommanding, @unchecked Sendable {
    /// What `pmdr app status --json` currently reports.
    var reportedState: Bool
    var readError: Error?
    var writeError: Error?
    private(set) var writes: [Bool] = []
    private(set) var reads = 0

    init(reportedState: Bool = false) {
        self.reportedState = reportedState
    }

    func loginItemEnabled() async throws -> Bool {
        reads += 1
        if let readError { throw readError }
        return reportedState
    }

    func setLoginItemEnabled(_ enabled: Bool) async throws {
        writes.append(enabled)
        if let writeError { throw writeError }
        reportedState = enabled
    }
}

private struct StubError: Error {}

@MainActor
final class LoginItemToggleTests: XCTestCase {
    func test_refresh_reflects_the_state_the_cli_reports() async {
        let commands = RecordingLoginItemCommands(reportedState: true)
        let toggle = LoginItemToggle(commands: commands)

        await toggle.refresh()

        XCTAssertTrue(toggle.isEnabled)
    }

    func test_toggling_off_state_asks_the_cli_to_enable_and_confirms_from_it() async {
        let commands = RecordingLoginItemCommands(reportedState: false)
        let toggle = LoginItemToggle(commands: commands)
        await toggle.refresh()

        await toggle.toggle()

        XCTAssertEqual(commands.writes, [true])
        XCTAssertTrue(toggle.isEnabled, "state must come from re-reading the CLI")
        XCTAssertEqual(commands.reads, 2, "toggle must confirm with a fresh read")
    }

    func test_toggling_on_state_asks_the_cli_to_disable() async {
        let commands = RecordingLoginItemCommands(reportedState: true)
        let toggle = LoginItemToggle(commands: commands)
        await toggle.refresh()

        await toggle.toggle()

        XCTAssertEqual(commands.writes, [false])
        XCTAssertFalse(toggle.isEnabled)
    }

    func test_a_failed_write_is_reported_and_leaves_the_state_alone() async {
        // `pmdr app login --enable` refuses when the app isn't installed. The
        // checkmark must not flip on a command that did nothing.
        let commands = RecordingLoginItemCommands(reportedState: false)
        commands.writeError = StubError()
        let toggle = LoginItemToggle(commands: commands)
        await toggle.refresh()

        let outcome = await toggle.toggle()

        guard case .failed = outcome else {
            return XCTFail("expected a failure outcome, got \(outcome)")
        }
        XCTAssertFalse(toggle.isEnabled)
    }

    func test_a_failed_write_reports_the_clis_own_message() async {
        let commands = RecordingLoginItemCommands(reportedState: false)
        commands.writeError = PmdrClientError.nonZeroExit(
            code: 1,
            stderr: "pmdr app login: app is not installed — run `pmdr app install` first\n"
        )
        let toggle = LoginItemToggle(commands: commands)

        let outcome = await toggle.toggle()

        XCTAssertEqual(
            outcome,
            .failed("pmdr app login: app is not installed — run `pmdr app install` first")
        )
    }

    func test_the_real_cli_client_can_drive_the_toggle() {
        // Compile-time wiring check: production uses PmdrClient here, so the
        // toggle must accept it without an adapter in AppDelegate.
        let toggle = LoginItemToggle(commands: PmdrClient())
        XCTAssertFalse(toggle.isEnabled, "starts pessimistic until refreshed")
    }

    func test_a_failed_read_leaves_the_last_known_state_alone() async {
        // A transient CLI failure must not silently uncheck the menu item.
        let commands = RecordingLoginItemCommands(reportedState: true)
        let toggle = LoginItemToggle(commands: commands)
        await toggle.refresh()

        commands.readError = StubError()
        await toggle.refresh()

        XCTAssertTrue(toggle.isEnabled)
    }
}

final class AppLoginCommandTests: XCTestCase {
    func test_enable_invokes_pmdr_app_login_enable() {
        XCTAssertEqual(PmdrClient.appLoginArguments(enable: true), ["app", "login", "--enable"])
    }

    func test_disable_invokes_pmdr_app_login_disable() {
        XCTAssertEqual(PmdrClient.appLoginArguments(enable: false), ["app", "login", "--disable"])
    }
}

final class AppStatusDecodingTests: XCTestCase {
    /// The JSON contract from `pmdr app status --json` (see the CLI's app-status.ts).
    private func appStatusJSON(loginItem: Bool) -> Data {
        Data(#"""
        {"install":"current","installedVersion":"0.1.0","installedPath":"/Users/x/Applications/pmdr.app","bundledVersion":"0.1.0","bundledReason":null,"running":true,"loginItem":\#(loginItem)}
        """#.utf8)
    }

    func test_decodes_login_item_enabled() throws {
        let status = try PmdrClient.decodeAppStatus(from: appStatusJSON(loginItem: true))
        XCTAssertTrue(status.loginItem)
    }

    func test_decodes_login_item_disabled() throws {
        let status = try PmdrClient.decodeAppStatus(from: appStatusJSON(loginItem: false))
        XCTAssertFalse(status.loginItem)
    }

    func test_unreadable_payload_is_a_decoding_failure() {
        // An older CLI without `pmdr app status` must surface as an error, not
        // as a confident "login item off".
        XCTAssertThrowsError(try PmdrClient.decodeAppStatus(from: Data("not json".utf8))) { error in
            guard case PmdrClientError.decodingFailed = error else {
                return XCTFail("expected decodingFailed, got \(error)")
            }
        }
    }
}
