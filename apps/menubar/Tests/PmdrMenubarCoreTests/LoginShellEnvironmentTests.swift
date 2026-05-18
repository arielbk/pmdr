import XCTest
@testable import PmdrMenubarCore

final class LoginShellEnvironmentTests: XCTestCase {
    func test_resolve_uses_login_shell_and_returns_resolved_PATH() {
        let baseEnvironment = [
            "HOME": "/Users/test",
            "PATH": "/usr/bin:/bin",
        ]

        let environment = LoginShellEnvironment.resolve(
            processEnvironment: baseEnvironment,
            loginShellPath: "/bin/zsh"
        ) { shellPath, arguments, timeout in
            XCTAssertEqual(shellPath, "/bin/zsh")
            XCTAssertEqual(arguments, ["-lic", #"printf '%s\n' "$PATH""#])
            XCTAssertEqual(timeout, 5)
            return .init(exitCode: 0, stdout: Data("/custom/bin:/usr/bin\n".utf8))
        }

        XCTAssertEqual(environment["HOME"], "/Users/test")
        XCTAssertEqual(environment["PATH"], "/custom/bin:/usr/bin")
    }

    func test_resolve_falls_back_to_process_environment_when_shell_returns_empty_PATH() {
        let baseEnvironment = [
            "HOME": "/Users/test",
            "PATH": "/usr/bin:/bin",
        ]

        let environment = LoginShellEnvironment.resolve(
            processEnvironment: baseEnvironment,
            loginShellPath: "/bin/zsh"
        ) { _, _, _ in
            .init(exitCode: 0, stdout: Data("\n".utf8))
        }

        XCTAssertEqual(environment, baseEnvironment)
    }
}
