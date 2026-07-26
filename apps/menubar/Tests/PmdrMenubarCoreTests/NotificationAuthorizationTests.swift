import XCTest
@testable import PmdrMenubarCore

private struct StubAuthorizer: NotificationAuthorizing {
    var granted = true
    var error: Error?

    func requestAuthorization() async throws -> Bool {
        if let error { throw error }
        return granted
    }
}

private struct AuthorizerBlewUp: Error {}

final class NotificationAuthorizationTests: XCTestCase {
    func test_a_granted_request_reports_granted() async {
        let outcome = await NotificationAuthorization.request(StubAuthorizer(granted: true))
        XCTAssertEqual(outcome, .granted)
    }

    func test_a_refused_request_reports_denied() async {
        let outcome = await NotificationAuthorization.request(StubAuthorizer(granted: false))
        XCTAssertEqual(outcome, .denied)
    }

    func test_a_throwing_request_reports_the_failure_rather_than_swallowing_it() async {
        let outcome = await NotificationAuthorization.request(
            StubAuthorizer(error: AuthorizerBlewUp())
        )
        guard case .failed(let description) = outcome else {
            return XCTFail("expected a failure outcome, got \(outcome)")
        }
        XCTAssertTrue(description.contains("AuthorizerBlewUp"), "got \(description)")
    }

    func test_the_real_presenter_is_the_authorizer() {
        // Wiring check: production asks through the same seam the tests drive,
        // so the result cannot be quietly discarded again. Checked at the type
        // level — instantiating the presenter needs `UNUserNotificationCenter
        // .current()`, which requires a real app bundle.
        XCTAssertTrue((UserNotificationsPresenter.self as Any.Type) is NotificationAuthorizing.Type)
    }

    func test_only_granted_has_nothing_to_tell_the_user() {
        XCTAssertNil(NotificationAuthorization.granted.problemMessage)
        XCTAssertNotNil(NotificationAuthorization.denied.problemMessage)
        XCTAssertNotNil(NotificationAuthorization.failed("boom").problemMessage)
    }
}
