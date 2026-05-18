import Foundation

/// Mirror of `Phase` from `apps/cli/src/commands/status.ts`.
public enum Phase: String, Codable, Sendable {
    case focus
    case `break`
}

/// Mirror of `StatusResult` from `apps/cli/src/commands/status.ts`.
public enum Status: Equatable, Sendable {
    case idle
    case running(Active)
    case paused(Active)

    public struct Active: Equatable, Sendable {
        public let remainingMs: Int
        public let durationMs: Int
        public let startedAt: Int
        public let phase: Phase
        public let completedFocusBlocks: Int

        public init(
            remainingMs: Int,
            durationMs: Int,
            startedAt: Int,
            phase: Phase,
            completedFocusBlocks: Int
        ) {
            self.remainingMs = remainingMs
            self.durationMs = durationMs
            self.startedAt = startedAt
            self.phase = phase
            self.completedFocusBlocks = completedFocusBlocks
        }
    }
}

public enum PmdrClientError: Error, Equatable {
    /// `pmdr` could not be located on PATH (or at the provided absolute path).
    case binaryNotFound
    /// `pmdr status --json` produced output we could not decode into `Status`.
    case decodingFailed(String)
    /// `pmdr` exited non-zero.
    case nonZeroExit(code: Int32, stderr: String)
}

public struct PmdrClient: Sendable {
    /// Either an absolute path to the `pmdr` binary, or a bare name to look up on PATH.
    public let binaryHint: String
    /// Environment passed to spawned processes — defaults to the parent's environment.
    /// PATH lookup uses the `PATH` entry from this dictionary.
    public let environment: [String: String]

    public init(
        binaryHint: String = "pmdr",
        environment: [String: String]? = nil
    ) {
        self.binaryHint = binaryHint
        var mergedEnvironment = ProcessInfo.processInfo.environment
        if let environment {
            for (key, value) in environment {
                mergedEnvironment[key] = value
            }
        }
        self.environment = mergedEnvironment
    }

    public func status() async throws -> Status {
        let data = try await run(arguments: ["status", "--json"])
        return try Self.decodeStatus(from: data)
    }

    // MARK: - Decoding

    private struct RawStatus: Decodable {
        let state: String
        let remainingMs: Int?
        let duration: Int?
        let startedAt: Int?
        let phase: Phase?
        let completedFocusBlocks: Int?
    }

    static func decodeStatus(from data: Data) throws -> Status {
        let raw: RawStatus
        do {
            raw = try JSONDecoder().decode(RawStatus.self, from: data)
        } catch {
            throw PmdrClientError.decodingFailed("invalid JSON: \(error)")
        }
        switch raw.state {
        case "idle":
            return .idle
        case "running", "paused":
            guard
                let remaining = raw.remainingMs,
                let duration = raw.duration,
                let startedAt = raw.startedAt,
                let phase = raw.phase,
                let blocks = raw.completedFocusBlocks
            else {
                throw PmdrClientError.decodingFailed(
                    "missing fields for state=\(raw.state)"
                )
            }
            let active = Status.Active(
                remainingMs: remaining,
                durationMs: duration,
                startedAt: startedAt,
                phase: phase,
                completedFocusBlocks: blocks
            )
            return raw.state == "running" ? .running(active) : .paused(active)
        default:
            throw PmdrClientError.decodingFailed("unknown state: \(raw.state)")
        }
    }

    // MARK: - Process

    /// Resolve `binaryHint` to an absolute executable path, searching `PATH` then
    /// returning `nil` so the caller can throw `.binaryNotFound` if no match is found.
    static func resolveBinary(
        hint: String,
        environment: [String: String]
    ) -> String? {
        if hint.hasPrefix("/") {
            return FileManager.default.isExecutableFile(atPath: hint) ? hint : nil
        }
        let pathEntries = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        for dir in pathEntries {
            let candidate = (dir as NSString).appendingPathComponent(hint)
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    private func run(arguments: [String]) async throws -> Data {
        guard let executable = Self.resolveBinary(
            hint: binaryHint,
            environment: environment
        ) else {
            throw PmdrClientError.binaryNotFound
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = environment

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch CocoaError.fileNoSuchFile {
            throw PmdrClientError.binaryNotFound
        } catch let nsError as NSError where nsError.domain == NSPOSIXErrorDomain && nsError.code == Int(ENOENT) {
            throw PmdrClientError.binaryNotFound
        }

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            let stderr = String(data: stderrData, encoding: .utf8) ?? ""
            throw PmdrClientError.nonZeroExit(code: process.terminationStatus, stderr: stderr)
        }

        return stdoutData
    }
}
