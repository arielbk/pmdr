import XCTest

final class LoginItemSettingTests: XCTestCase {
    func testLaunchAtLoginUsesTheExpectedSettingsLabel() {
        XCTAssertEqual(LoginItemSetting.title, "Launch at login")
    }
}
