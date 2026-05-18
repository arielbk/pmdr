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
        public let project: String?

        public init(
            remainingMs: Int,
            durationMs: Int,
            startedAt: Int,
            phase: Phase,
            completedFocusBlocks: Int,
            project: String? = nil
        ) {
            self.remainingMs = remainingMs
            self.durationMs = durationMs
            self.startedAt = startedAt
            self.phase = phase
            self.completedFocusBlocks = completedFocusBlocks
            self.project = project
        }
    }
}

public struct ProjectRecord: Equatable, Sendable {
    public let name: String
    public let archived: Bool
    public let createdAt: String

    public init(name: String, archived: Bool, createdAt: String) {
        self.name = name
        self.archived = archived
        self.createdAt = createdAt
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

    public func start(project: String) async throws {
        _ = try await run(arguments: ["start", "--force", "--detach", "--project", project])
    }

    public func pause() async throws {
        _ = try await run(arguments: ["pause"])
    }

    public func resume() async throws {
        _ = try await run(arguments: ["resume"])
    }

    public func stop() async throws {
        _ = try await run(arguments: ["stop"])
    }

    public func listProjects() async throws -> [ProjectRecord] {
        let data = try await run(arguments: ["project", "list", "--json"])
        return try Self.decodeProjects(from: data)
    }

    // MARK: - Decoding

    private struct RawStatus: Decodable {
        let state: String
        let remainingMs: Int?
        let duration: Int?
        let startedAt: Int?
        let phase: Phase?
        let completedFocusBlocks: Int?
        let project: String?
    }

    private struct RawProjects: Decodable {
        let projects: [RawProject]
    }

    private struct RawProject: Decodable {
        let name: String
        let archived: Bool
        let createdAt: String
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
                completedFocusBlocks: blocks,
                project: raw.project
            )
            return raw.state == "running" ? .running(active) : .paused(active)
        default:
            throw PmdrClientError.decodingFailed("unknown state: \(raw.state)")
        }
    }

    static func decodeProjects(from data: Data) throws -> [ProjectRecord] {
        do {
            let raw = try JSONDecoder().decode(RawProjects.self, from: data)
            return raw.projects.map {
                ProjectRecord(name: $0.name, archived: $0.archived, createdAt: $0.createdAt)
            }
        } catch {
            throw PmdrClientError.decodingFailed("invalid projects JSON: \(error)")
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
