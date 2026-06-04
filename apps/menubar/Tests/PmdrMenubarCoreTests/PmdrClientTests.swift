import XCTest
@testable import PmdrMenubarCore

final class PmdrClientDecodingTests: XCTestCase {
    func test_decodes_idle_state() throws {
        let json = Data(#"{"state":"idle"}"#.utf8)
        XCTAssertEqual(try PmdrClient.decodeStatus(from: json), .idle)
    }

    func test_decodes_running_focus_state() throws {
        let json = Data(#"""
        {"state":"running","remainingMs":1500000,"duration":1500000,"startedAt":1700000000000,"phase":"focus","completedFocusBlocks":0}
        """#.utf8)
        let expected = Status.running(.init(
            remainingMs: 1500000,
            durationMs: 1500000,
            startedAt: 1700000000000,
            phase: .focus,
            completedFocusBlocks: 0
        ))
        XCTAssertEqual(try PmdrClient.decodeStatus(from: json), expected)
    }

    func test_decodes_paused_break_state() throws {
        let json = Data(#"""
        {"state":"paused","remainingMs":120000,"duration":300000,"startedAt":1700000000000,"phase":"break","completedFocusBlocks":2}
        """#.utf8)
        let expected = Status.paused(.init(
            remainingMs: 120000,
            durationMs: 300000,
            startedAt: 1700000000000,
            phase: .break,
            completedFocusBlocks: 2
        ))
        XCTAssertEqual(try PmdrClient.decodeStatus(from: json), expected)
    }

    func test_decodes_project_when_present() throws {
        let json = Data(#"""
        {"state":"running","remainingMs":1500000,"duration":1500000,"startedAt":1700000000000,"phase":"focus","completedFocusBlocks":0,"project":"deepwork"}
        """#.utf8)
        let status = try PmdrClient.decodeStatus(from: json)
        guard case .running(let active) = status else {
            return XCTFail("expected running, got \(status)")
        }
        XCTAssertEqual(active.project, "deepwork")
    }

    func test_decodes_project_list() throws {
        let json = Data(#"""
        {"projects":[{"name":"alpha","archived":false,"createdAt":"2026-05-18T10:00:00.000Z"},{"name":"old","archived":true,"createdAt":"2026-05-17T10:00:00.000Z"}]}
        """#.utf8)
        XCTAssertEqual(try PmdrClient.decodeProjects(from: json), [
            ProjectRecord(name: "alpha", archived: false, createdAt: "2026-05-18T10:00:00.000Z"),
            ProjectRecord(name: "old", archived: true, createdAt: "2026-05-17T10:00:00.000Z"),
        ])
    }

    func test_decodes_full_effective_config() throws {
        let json = Data(#"""
        {"focusMinutes":50,"shortBreakMinutes":10,"longBreakMinutes":30,"longBreakEvery":2,"focusEndSound":"Ping","breakEndSound":"Pop"}
        """#.utf8)
        XCTAssertEqual(try PmdrClient.decodeConfig(from: json), .init(
            focusMinutes: 50,
            shortBreakMinutes: 10,
            longBreakMinutes: 30,
            longBreakEvery: 2,
            focusEndSound: "Ping",
            breakEndSound: "Pop"
        ))
    }

    func test_decodes_partial_config_with_defaults() throws {
        let json = Data(#"{"focusMinutes":45,"breakEndSound":"Hero"}"#.utf8)
        XCTAssertEqual(try PmdrClient.decodeConfig(from: json), .init(
            focusMinutes: 45,
            shortBreakMinutes: 5,
            longBreakMinutes: 15,
            longBreakEvery: 4,
            focusEndSound: "Glass",
            breakEndSound: "Hero"
        ))
    }

    func test_throws_decoding_failed_on_unknown_state() {
        let json = Data(#"{"state":"wat"}"#.utf8)
        XCTAssertThrowsError(try PmdrClient.decodeStatus(from: json)) { error in
            guard case PmdrClientError.decodingFailed = error else {
                return XCTFail("expected decodingFailed, got \(error)")
            }
        }
    }

    func test_throws_decoding_failed_on_missing_fields_for_running() {
        let json = Data(#"{"state":"running"}"#.utf8)
        XCTAssertThrowsError(try PmdrClient.decodeStatus(from: json)) { error in
            guard case PmdrClientError.decodingFailed = error else {
                return XCTFail("expected decodingFailed, got \(error)")
            }
        }
    }

    func test_throws_decoding_failed_on_invalid_json() {
        let json = Data(#"not json"#.utf8)
        XCTAssertThrowsError(try PmdrClient.decodeStatus(from: json)) { error in
            guard case PmdrClientError.decodingFailed = error else {
                return XCTFail("expected decodingFailed, got \(error)")
            }
        }
    }
}

final class PmdrClientArgvTests: XCTestCase {
    /// Run the client against a stub `pmdr` binary that writes its argv to a file
    /// and returns canned stdout. Lets us assert exactly which CLI args each
    /// method invokes without needing the real pmdr binary.
    func test_listProjects_passes_include_archived_when_requested() async throws {
        let (client, argvLog) = try makeArgvCapturingClient(stdout: #"{"projects":[]}"#)
        _ = try await client.listProjects(includeArchived: true)
        XCTAssertEqual(readArgv(argvLog), ["project", "list", "--json", "--include-archived"])
    }

    func test_listProjects_omits_include_archived_by_default() async throws {
        let (client, argvLog) = try makeArgvCapturingClient(stdout: #"{"projects":[]}"#)
        _ = try await client.listProjects()
        XCTAssertEqual(readArgv(argvLog), ["project", "list", "--json"])
    }

    func test_archiveProject_invokes_archive_subcommand() async throws {
        let (client, argvLog) = try makeArgvCapturingClient(stdout: "")
        try await client.archiveProject("alpha")
        XCTAssertEqual(readArgv(argvLog), ["project", "archive", "alpha"])
    }

    func test_unarchiveProject_invokes_unarchive_subcommand() async throws {
        let (client, argvLog) = try makeArgvCapturingClient(stdout: "")
        try await client.unarchiveProject("alpha")
        XCTAssertEqual(readArgv(argvLog), ["project", "unarchive", "alpha"])
    }

    func test_config_invokes_config_json() async throws {
        let (client, argvLog) = try makeArgvCapturingClient(stdout: #"{"focusMinutes":50}"#)
        let config = try await client.config()
        XCTAssertEqual(config.focusMinutes, 50)
        XCTAssertEqual(readArgv(argvLog), ["config", "--json"])
    }

    func test_setConfigValue_invokes_config_set() async throws {
        let (client, argvLog) = try makeArgvCapturingClient(stdout: "")
        try await client.setConfigValue(key: "focusMinutes", value: "50")
        XCTAssertEqual(readArgv(argvLog), ["config", "set", "focusMinutes", "50"])
    }

    private func makeArgvCapturingClient(stdout: String) throws -> (PmdrClient, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pmdr-argv-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let argvLog = dir.appendingPathComponent("argv.txt")
        let script = dir.appendingPathComponent("pmdr")
        let body = """
        #!/bin/sh
        printf '%s\\n' "$@" > \(argvLog.path)
        printf '%s' '\(stdout)'
        """
        try Data(body.utf8).write(to: script)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
        let client = PmdrClient(binaryHint: "pmdr", environment: ["PATH": dir.path])
        return (client, argvLog)
    }

    private func readArgv(_ url: URL) -> [String] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        return raw.split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
            .filter { !$0.isEmpty }
    }
}

final class PmdrClientBinaryResolutionTests: XCTestCase {
    func test_returns_nil_when_binary_missing_on_PATH() throws {
        let emptyDir = try makeTempDir()
        let resolved = PmdrClient.resolveBinary(
            hint: "pmdr",
            environment: ["PATH": emptyDir.path]
        )
        XCTAssertNil(resolved)
    }

    func test_status_throws_binaryNotFound_when_not_on_PATH() async {
        let emptyDir: URL
        do {
            emptyDir = try makeTempDir()
        } catch {
            return XCTFail("could not make temp dir: \(error)")
        }
        let client = PmdrClient(
            binaryHint: "pmdr",
            environment: ["PATH": emptyDir.path]
        )
        do {
            _ = try await client.status()
            XCTFail("expected .binaryNotFound")
        } catch PmdrClientError.binaryNotFound {
            // expected
        } catch {
            XCTFail("expected .binaryNotFound, got \(error)")
        }
    }

    func test_resolves_absolute_path_when_executable() throws {
        let dir = try makeTempDir()
        let script = dir.appendingPathComponent("pmdr-stub")
        try Data("#!/bin/sh\necho stub\n".utf8).write(to: script)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
        let resolved = PmdrClient.resolveBinary(hint: script.path, environment: [:])
        XCTAssertEqual(resolved, script.path)
    }

    func test_finds_binary_on_PATH() throws {
        let dir = try makeTempDir()
        let script = dir.appendingPathComponent("pmdr")
        try Data("#!/bin/sh\necho hi\n".utf8).write(to: script)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
        let resolved = PmdrClient.resolveBinary(
            hint: "pmdr",
            environment: ["PATH": dir.path]
        )
        XCTAssertEqual(resolved, script.path)
    }

    func test_finds_binary_in_resolved_environment_PATH() throws {
        let dir = try makeTempDir()
        let script = dir.appendingPathComponent("pmdr")
        try Data("#!/bin/sh\necho hi\n".utf8).write(to: script)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
        let resolved = PmdrClient.resolveBinary(
            hint: "pmdr",
            environment: ["PATH": dir.path]
        )
        XCTAssertEqual(resolved, script.path)
    }

    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pmdr-client-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir
    }
}

/// Integration tests against the real `pmdr` binary.
///
/// Skipped automatically unless the `PMDR_INTEGRATION=1` environment variable is
/// set, because they shell out to a real `pmdr` and need to mutate state under
/// an isolated `HOME`. Run with:
///
///     PMDR_INTEGRATION=1 xcodebuild test -scheme pmdr-menubar
///
/// The tests assume `pmdr` is on PATH (i.e. you ran `pnpm --filter cli build`
/// and either symlinked or installed the bin).
final class PmdrClientIntegrationTests: XCTestCase {
    private var fakeHome: URL!

    override func setUpWithError() throws {
        guard ProcessInfo.processInfo.environment["PMDR_INTEGRATION"] == "1" else {
            throw XCTSkip("set PMDR_INTEGRATION=1 to run integration tests")
        }
        fakeHome = FileManager.default.temporaryDirectory
            .appendingPathComponent("pmdr-int-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: fakeHome, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let fakeHome { try? FileManager.default.removeItem(at: fakeHome) }
    }

    func test_idle_status_decodes() async throws {
        let client = makeClient()
        let status = try await client.status()
        XCTAssertEqual(status, .idle)
    }

    func test_running_status_decodes_after_start() async throws {
        try shellOut(["start", "--force", "--project", "test"])
        let client = makeClient()
        let status = try await client.status()
        guard case .running(let active) = status else {
            return XCTFail("expected running, got \(status)")
        }
        XCTAssertEqual(active.phase, .focus)
        XCTAssertGreaterThan(active.remainingMs, 0)
    }

    func test_paused_status_decodes_after_pause() async throws {
        try shellOut(["start", "--force", "--project", "test"])
        try shellOut(["pause"])
        let client = makeClient()
        let status = try await client.status()
        guard case .paused = status else {
            return XCTFail("expected paused, got \(status)")
        }
    }

    private func makeClient() -> PmdrClient {
        var env = ProcessInfo.processInfo.environment
        env["HOME"] = fakeHome.path
        return PmdrClient(environment: env)
    }

    private func shellOut(_ arguments: [String]) throws {
        var env = ProcessInfo.processInfo.environment
        env["HOME"] = fakeHome.path
        guard let binary = PmdrClient.resolveBinary(hint: "pmdr", environment: env) else {
            throw XCTSkip("pmdr not on PATH")
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = arguments
        process.environment = env
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0, "pmdr \(arguments.joined(separator: " ")) failed")
    }
}
