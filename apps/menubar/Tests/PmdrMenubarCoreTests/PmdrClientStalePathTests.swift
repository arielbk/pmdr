import XCTest
@testable import PmdrMenubarCore

/// The app resolves the login-shell PATH once, at launch, and holds it for its
/// whole lifetime. Node version managers (fnm, nvm, volta) put their shims in
/// per-shell directories that disappear when that shell exits — so a PATH that
/// worked at launch can name a directory that no longer exists, and the menubar
/// silently stops updating until someone relaunches the app.
///
/// These tests pin the recovery: when resolution fails, re-resolve the
/// environment once and retry, then keep the refreshed environment.
final class PmdrClientStalePathTests: XCTestCase {
    private func makeStubBinary(named name: String = "pmdr", in dir: URL, stdout: String) throws {
        let script = dir.appendingPathComponent(name)
        try Data("#!/bin/sh\nprintf '%s' '\(stdout)'\n".utf8).write(to: script)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: script.path
        )
    }

    private func makeDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pmdr-stale-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir
    }

    func test_recovers_when_the_cached_PATH_has_gone_stale() async throws {
        let staleDir = try makeDir()
        let freshDir = try makeDir()
        try makeStubBinary(in: freshDir, stdout: #"{"state":"idle"}"#)
        // The stale directory is removed, exactly as an exited shell's shim dir is.
        try FileManager.default.removeItem(at: staleDir)

        let client = PmdrClient(
            binaryHint: "pmdr",
            environment: ["PATH": staleDir.path],
            environmentRefresh: { ["PATH": freshDir.path] }
        )

        let status = try await client.status()
        XCTAssertEqual(status, .idle)
    }

    func test_does_not_refresh_when_the_binary_still_resolves() async throws {
        let dir = try makeDir()
        try makeStubBinary(in: dir, stdout: #"{"state":"idle"}"#)

        let refreshCount = Counter()
        let client = PmdrClient(
            binaryHint: "pmdr",
            environment: ["PATH": dir.path],
            environmentRefresh: {
                refreshCount.increment()
                return ["PATH": dir.path]
            }
        )

        _ = try await client.status()
        XCTAssertEqual(refreshCount.value, 0, "the happy path must not spawn a login shell")
    }

    func test_keeps_the_refreshed_environment_for_later_calls() async throws {
        let staleDir = try makeDir()
        let freshDir = try makeDir()
        try makeStubBinary(in: freshDir, stdout: #"{"state":"idle"}"#)
        try FileManager.default.removeItem(at: staleDir)

        let refreshCount = Counter()
        let client = PmdrClient(
            binaryHint: "pmdr",
            environment: ["PATH": staleDir.path],
            environmentRefresh: {
                refreshCount.increment()
                return ["PATH": freshDir.path]
            }
        )

        _ = try await client.status()
        _ = try await client.status()

        XCTAssertEqual(
            refreshCount.value,
            1,
            "a recovered PATH should be cached, not re-derived on every poll"
        )
    }

    func test_still_throws_binaryNotFound_when_the_refresh_cannot_help() async throws {
        let staleDir = try makeDir()
        let alsoEmpty = try makeDir()
        try FileManager.default.removeItem(at: staleDir)

        let client = PmdrClient(
            binaryHint: "pmdr",
            environment: ["PATH": staleDir.path],
            environmentRefresh: { ["PATH": alsoEmpty.path] }
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

    func test_without_a_refresh_hook_the_behaviour_is_unchanged() async throws {
        let emptyDir = try makeDir()
        let client = PmdrClient(binaryHint: "pmdr", environment: ["PATH": emptyDir.path])

        do {
            _ = try await client.status()
            XCTFail("expected .binaryNotFound")
        } catch PmdrClientError.binaryNotFound {
            // expected
        } catch {
            XCTFail("expected .binaryNotFound, got \(error)")
        }
    }
}

/// Minimal thread-safe counter — the refresh hook is `@Sendable`.
private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }
}
