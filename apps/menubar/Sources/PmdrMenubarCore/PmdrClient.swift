import Foundation

/// Mirror of `Phase` from `apps/cli/src/commands/status.ts`.
public enum Phase: String, Codable, Sendable {
    case focus
    case `break`
}

/// Mirror of `StatusResult` from `apps/cli/src/commands/status.ts`.
public enum Status: Equatable, Sendable {
    case idle(todayFocusBlocks: Int = 0)
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

/// Mirror of `NoteRecord` from `apps/cli/src/state.ts`.
public struct NoteRecord: Equatable, Sendable {
    public let text: String
    /// Capture time, epoch milliseconds.
    public let at: Int
    /// Live session at capture; empty when the timer was idle.
    public let sessionId: String
    public let project: String
    public let phase: String

    public init(
        text: String,
        at: Int,
        sessionId: String = "",
        project: String = "",
        phase: String = ""
    ) {
        self.text = text
        self.at = at
        self.sessionId = sessionId
        self.project = project
        self.phase = phase
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

/// Mirror of the `pmdr app status --json` payload (`apps/cli/src/app-status.ts`).
/// Only the fields the app actually acts on are modelled; the CLI never omits
/// keys, it nulls them.
public struct AppStatus: Equatable, Sendable {
    /// Whether a `dev.pmdr.menubar` LaunchAgent plist is on disk. The plist's
    /// presence *is* the login-item state — the CLI owns writing it.
    public let loginItem: Bool

    public init(loginItem: Bool) {
        self.loginItem = loginItem
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

/// Holds the environment behind a reference so a PATH recovered mid-session
/// outlives the `PmdrClient` value that recovered it.
final class EnvironmentStore: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String: String]

    init(_ environment: [String: String]) {
        self.stored = environment
    }

    var value: [String: String] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func replace(with environment: [String: String]) {
        lock.lock()
        stored = environment
        lock.unlock()
    }
}

public struct PmdrClient: Sendable {
    /// Either an absolute path to the `pmdr` binary, or a bare name to look up on PATH.
    public let binaryHint: String
    /// Environment passed to spawned processes — defaults to the parent's environment.
    /// PATH lookup uses the `PATH` entry from this dictionary.
    public var environment: [String: String] { environmentStore.value }

    private let environmentStore: EnvironmentStore

    /// Re-derives the environment when `binaryHint` stops resolving.
    ///
    /// The app captures the login-shell PATH once, at launch. Node version
    /// managers (fnm, nvm, volta) hand out per-shell shim directories that go
    /// away when that shell exits, so a PATH that worked at launch can name a
    /// directory that no longer exists — and without this the menubar would
    /// silently stop updating until someone relaunched the app.
    private let environmentRefresh: (@Sendable () -> [String: String])?

    public init(
        binaryHint: String = "pmdr",
        environment: [String: String]? = nil,
        environmentRefresh: (@Sendable () -> [String: String])? = nil
    ) {
        self.binaryHint = binaryHint
        self.environmentStore = EnvironmentStore(Self.merged(environment))
        self.environmentRefresh = environmentRefresh
    }

    /// Overlay caller-supplied entries onto the parent environment, so a refresh
    /// that returns only `PATH` still spawns with a complete environment.
    private static func merged(_ environment: [String: String]?) -> [String: String] {
        var mergedEnvironment = ProcessInfo.processInfo.environment
        if let environment {
            for (key, value) in environment {
                mergedEnvironment[key] = value
            }
        }
        return mergedEnvironment
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

    /// Append a timestamped note via the CLI (`pmdr note <text>`). The CLI stamps
    /// the live session/project/phase and no-ops on whitespace-only text.
    public func note(_ text: String) async throws {
        _ = try await run(arguments: ["note", text])
    }

    /// Today's captured notes, from `pmdr today --json`. The CLI already filters
    /// to the local calendar day and sorts ascending by time.
    public func todayNotes() async throws -> [NoteRecord] {
        let data = try await run(arguments: ["today", "--json"])
        return try Self.decodeTodayNotes(from: data)
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

    /// `pmdr app status --json` — the app's install/run/login-item state.
    public func appStatus() async throws -> AppStatus {
        let data = try await run(arguments: ["app", "status", "--json"])
        return try Self.decodeAppStatus(from: data)
    }

    static func appLoginArguments(enable: Bool) -> [String] {
        ["app", "login", enable ? "--enable" : "--disable"]
    }

    /// `pmdr app login --enable | --disable`. The CLI owns the LaunchAgent
    /// plist; the app never writes it itself.
    public func setAppLoginItem(enabled: Bool) async throws {
        _ = try await run(arguments: Self.appLoginArguments(enable: enabled))
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

    private struct RawToday: Decodable {
        /// Absent in CLI versions that predate note capture — read as no notes
        /// rather than as a decoding failure.
        let notes: [RawNote]?
    }

    private struct RawNote: Decodable {
        let text: String
        let at: Int
        let sessionId: String?
        let project: String?
        let phase: String?
    }

    private struct RawProjects: Decodable {
        let projects: [RawProject]
    }

    private struct RawProject: Decodable {
        let name: String
        let archived: Bool
        let createdAt: String
    }

    private struct RawAppStatus: Decodable {
        let loginItem: Bool
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
            return .idle(todayFocusBlocks: raw.todayFocusBlocks ?? 0)
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

    static func decodeTodayNotes(from data: Data) throws -> [NoteRecord] {
        do {
            let raw = try JSONDecoder().decode(RawToday.self, from: data)
            return (raw.notes ?? []).map {
                NoteRecord(
                    text: $0.text,
                    at: $0.at,
                    sessionId: $0.sessionId ?? "",
                    project: $0.project ?? "",
                    phase: $0.phase ?? ""
                )
            }
        } catch {
            throw PmdrClientError.decodingFailed("invalid today JSON: \(error)")
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

    static func decodeAppStatus(from data: Data) throws -> AppStatus {
        do {
            let raw = try JSONDecoder().decode(RawAppStatus.self, from: data)
            return AppStatus(loginItem: raw.loginItem)
        } catch {
            throw PmdrClientError.decodingFailed("invalid app status JSON: \(error)")
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

    /// Resolve `binaryHint`, re-deriving the environment once if the cached PATH
    /// has gone stale. The refresh is only paid for on failure — the polling
    /// happy path never spawns a login shell.
    private func resolveExecutable() throws -> String {
        if let executable = Self.resolveBinary(
            hint: binaryHint,
            environment: environment
        ) {
            return executable
        }

        guard let environmentRefresh else {
            throw PmdrClientError.binaryNotFound
        }

        let refreshed = Self.merged(environmentRefresh())
        environmentStore.replace(with: refreshed)

        guard let executable = Self.resolveBinary(
            hint: binaryHint,
            environment: refreshed
        ) else {
            throw PmdrClientError.binaryNotFound
        }
        return executable
    }

    private func run(arguments: [String]) async throws -> Data {
        let executable = try resolveExecutable()
        let environment = self.environment

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
