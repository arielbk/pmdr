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
        public let todayFocusBlocks: Int
        public let project: String?

        public init(
            remainingMs: Int,
            durationMs: Int,
            startedAt: Int,
            phase: Phase,
            completedFocusBlocks: Int,
            todayFocusBlocks: Int = 0,
            project: String? = nil
        ) {
            self.remainingMs = remainingMs
            self.durationMs = durationMs
            self.startedAt = startedAt
            self.phase = phase
            self.completedFocusBlocks = completedFocusBlocks
            self.todayFocusBlocks = todayFocusBlocks
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

public struct PmdrConfig: Equatable, Sendable {
    public static let defaults = PmdrConfig()

    public let focusMinutes: Int
    public let shortBreakMinutes: Int
    public let longBreakMinutes: Int
    public let longBreakEvery: Int
    public let dailyGoal: Int
    public let focusEndSound: String
    public let breakEndSound: String

    public init(
        focusMinutes: Int = 25,
        shortBreakMinutes: Int = 5,
        longBreakMinutes: Int = 15,
        longBreakEvery: Int = 4,
        dailyGoal: Int = 8,
        focusEndSound: String = "Glass",
        breakEndSound: String = "Submarine"
    ) {
        self.focusMinutes = focusMinutes
        self.shortBreakMinutes = shortBreakMinutes
        self.longBreakMinutes = longBreakMinutes
        self.longBreakEvery = longBreakEvery
        self.dailyGoal = dailyGoal
        self.focusEndSound = focusEndSound
        self.breakEndSound = breakEndSound
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

    public func start(project: String? = nil, forceUnassigned: Bool = false) async throws {
        var args = ["start", "--force", "--detach"]
        if let project {
            args.append(contentsOf: ["--project", project])
        } else if forceUnassigned {
            args.append("--no-project")
        }
        _ = try await run(arguments: args)
    }

    public func setProject(_ name: String?) async throws {
        var args = ["project", "set"]
        if let name {
            args.append(name)
        } else {
            args.append("--none")
        }
        _ = try await run(arguments: args)
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

    public func listProjects(includeArchived: Bool = false) async throws -> [ProjectRecord] {
        var args = ["project", "list", "--json"]
        if includeArchived {
            args.append("--include-archived")
        }
        let data = try await run(arguments: args)
        return try Self.decodeProjects(from: data)
    }

    public func config() async throws -> PmdrConfig {
        let data = try await run(arguments: ["config", "--json"])
        return try Self.decodeConfig(from: data)
    }

    public func setConfigValue(key: String, value: String) async throws {
        _ = try await run(arguments: ["config", "set", key, value])
    }

    public func archiveProject(_ name: String) async throws {
        _ = try await run(arguments: ["project", "archive", name])
    }

    public func unarchiveProject(_ name: String) async throws {
        _ = try await run(arguments: ["project", "unarchive", name])
    }

    // MARK: - Decoding

    private struct RawStatus: Decodable {
        let state: String
        let remainingMs: Int?
        let duration: Int?
        let startedAt: Int?
        let phase: Phase?
        let completedFocusBlocks: Int?
        let todayFocusBlocks: Int?
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

    private struct RawConfig: Decodable {
        let focusMinutes: Int?
        let shortBreakMinutes: Int?
        let longBreakMinutes: Int?
        let longBreakEvery: Int?
        let dailyGoal: Int?
        let focusEndSound: String?
        let breakEndSound: String?
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
                todayFocusBlocks: raw.todayFocusBlocks ?? 0,
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

    static func decodeConfig(from data: Data) throws -> PmdrConfig {
        do {
            let raw = try JSONDecoder().decode(RawConfig.self, from: data)
            let defaults = PmdrConfig.defaults
            return PmdrConfig(
                focusMinutes: raw.focusMinutes ?? defaults.focusMinutes,
                shortBreakMinutes: raw.shortBreakMinutes ?? defaults.shortBreakMinutes,
                longBreakMinutes: raw.longBreakMinutes ?? defaults.longBreakMinutes,
                longBreakEvery: raw.longBreakEvery ?? defaults.longBreakEvery,
                dailyGoal: raw.dailyGoal ?? defaults.dailyGoal,
                focusEndSound: raw.focusEndSound ?? defaults.focusEndSound,
                breakEndSound: raw.breakEndSound ?? defaults.breakEndSound
            )
        } catch {
            throw PmdrClientError.decodingFailed("invalid config JSON: \(error)")
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
