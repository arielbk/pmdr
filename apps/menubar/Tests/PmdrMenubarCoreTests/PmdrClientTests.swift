import XCTest
@testable import pmdr

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
