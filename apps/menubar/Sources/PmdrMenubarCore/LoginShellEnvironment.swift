import Foundation
import Darwin

public enum LoginShellEnvironment {
    enum Error: Swift.Error {
        case missingShell
        case timedOut
        case emptyPath
    }

    struct ShellResult {
        let exitCode: Int32
        let stdout: Data
    }

    typealias ShellRunner = (
        _ shellPath: String,
        _ arguments: [String],
        _ timeout: TimeInterval
    ) throws -> ShellResult

    public static func resolve() -> [String: String] {
        resolve(
            processEnvironment: ProcessInfo.processInfo.environment,
            loginShellPath: loginShellPath(),
            runner: runShell
        )
    }

    static func resolve(
        processEnvironment: [String: String],
        loginShellPath: String?,
        runner: ShellRunner
    ) -> [String: String] {
        guard let shellPath = loginShellPath, !shellPath.isEmpty else {
            return processEnvironment
        }

        do {
            let result = try runner(shellPath, ["-lic", #"printf '%s\n' "$PATH""#], 5)
            guard result.exitCode == 0 else {
                return processEnvironment
            }
            let resolvedPath = try parsePath(from: result.stdout)
            var environment = processEnvironment
            environment["PATH"] = resolvedPath
            return environment
        } catch {
            return processEnvironment
        }
    }

    static func loginShellPath() -> String? {
        guard let passwd = getpwuid(getuid()),
              let shell = passwd.pointee.pw_shell else {
            return nil
        }
        return String(cString: shell)
    }

    static func parsePath(from data: Data) throws -> String {
        guard let output = String(data: data, encoding: .utf8) else {
            throw Error.emptyPath
        }
        let lines = output
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard let path = lines.last, !path.isEmpty else {
            throw Error.emptyPath
        }
        return path
    }

    static func runShell(
        shellPath: String,
        arguments: [String],
        timeout: TimeInterval
    ) throws -> ShellResult {
        guard FileManager.default.isExecutableFile(atPath: shellPath) else {
            throw Error.missingShell
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: shellPath)
        process.arguments = arguments

        let stdoutPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = Pipe()

        try process.run()

        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            process.waitUntilExit()
            finished.signal()
        }

        if finished.wait(timeout: .now() + timeout) == .timedOut {
            process.terminate()
            throw Error.timedOut
        }

        let stdout = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        return ShellResult(exitCode: process.terminationStatus, stdout: stdout)
    }
}
