import AppKit
import PmdrMenubarCore
import XCTest

@MainActor
final class OverlaySurfaceTests: XCTestCase {
    private func luminance(of color: NSColor) -> CGFloat {
        guard let rgb = color.usingColorSpace(.sRGB) else { return -1 }
        return 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
    }

    func testSurfaceUsesAnActiveBehindWindowMaterial() {
        let view = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))

        OverlaySurface.standard.apply(to: view)

        XCTAssertEqual(view.material, .hudWindow)
        XCTAssertEqual(view.blendingMode, .behindWindow)
        XCTAssertEqual(view.state, .active)
        XCTAssertTrue(view.isEmphasized)
    }

    func testSurfaceAddsATranslucentDarkTintWithoutHidingTheMaterial() {
        let view = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))

        OverlaySurface.standard.apply(to: view)

        guard let tintView = view.subviews.first(where: {
            $0.identifier == OverlaySurface.tintViewIdentifier
        }),
        let fill = tintView.layer?.backgroundColor.map({ NSColor(cgColor: $0) }) ?? nil
        else {
            XCTFail("Expected the surface to install a stabilising tint")
            return
        }
        // Opaque enough to hold contrast over white; translucent enough for the
        // material's blur and colour bleed to remain visible.
        XCTAssertGreaterThanOrEqual(fill.alphaComponent, 0.45)
        XCTAssertLessThanOrEqual(fill.alphaComponent, 0.75)
        XCTAssertLessThan(luminance(of: fill), 0.2)
        XCTAssertEqual(tintView.frame, view.bounds)
        XCTAssertTrue(tintView.autoresizingMask.contains(.width))
        XCTAssertTrue(tintView.autoresizingMask.contains(.height))
        XCTAssertNil(tintView.hitTest(NSPoint(x: 50, y: 50)))
    }

    func testSurfaceDrawsAHairlineBorderLighterThanItsFill() {
        let view = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))

        OverlaySurface.standard.apply(to: view)

        guard let layer = view.layer,
              let border = layer.borderColor.map({ NSColor(cgColor: $0) }) ?? nil,
              let tintView = view.subviews.first(where: {
                  $0.identifier == OverlaySurface.tintViewIdentifier
              }),
              let fill = tintView.layer?.backgroundColor.map({ NSColor(cgColor: $0) }) ?? nil
        else {
            XCTFail("Expected the surface to install a border")
            return
        }
        XCTAssertGreaterThan(layer.borderWidth, 0)
        XCTAssertLessThanOrEqual(layer.borderWidth, 1)
        // The edge has to read against dark content too, so it lightens the fill.
        XCTAssertGreaterThan(
            luminance(of: border.blended(withFraction: 1 - border.alphaComponent, of: fill) ?? border),
            luminance(of: fill)
        )
    }

    func testSurfaceRoundsAndClipsItsCorners() {
        let view = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))

        OverlaySurface.standard.apply(to: view)

        XCTAssertEqual(view.layer?.cornerRadius, OverlaySurface.standard.cornerRadius)
        XCTAssertGreaterThan(OverlaySurface.standard.cornerRadius, 0)
        XCTAssertEqual(view.layer?.masksToBounds, true)
    }

    func testSurfaceResolvesSemanticForegroundColorsForDarkContent() {
        let view = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))
        let label = NSTextField(labelWithString: "IDLE")
        view.addSubview(label)

        OverlaySurface.standard.apply(to: view)

        // Chrome keeps using semantic colors; the surface guarantees they land light.
        var resolved: NSColor?
        label.effectiveAppearance.performAsCurrentDrawingAppearance {
            resolved = NSColor.labelColor.usingColorSpace(.sRGB)
        }
        guard let resolved else {
            XCTFail("Expected labelColor to resolve in the surface's appearance")
            return
        }
        XCTAssertGreaterThan(luminance(of: resolved), 0.5)
    }

    func testSurfaceConfiguresItsPanelToShowOnlyTheSurface() {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        OverlaySurface.standard.configure(panel)

        XCTAssertEqual(panel.backgroundColor, .clear)
        XCTAssertFalse(panel.isOpaque)
        XCTAssertTrue(panel.hasShadow)
    }

    func testSurfaceInsetsItsPanelSoTheShadowFollowsTheRoundedShape() {
        let surface = OverlaySurface.standard
        let visual = NSSize(width: 480, height: 46)

        let panelSize = surface.panelSize(forVisualSize: visual)
        let surfaceFrame = surface.surfaceFrame(forVisualSize: visual)

        XCTAssertEqual(surfaceFrame.size, visual)
        XCTAssertGreaterThan(surfaceFrame.minX, 0)
        XCTAssertGreaterThan(surfaceFrame.minY, 0)
        // Equal transparent padding on every side keeps the shadow centered.
        XCTAssertEqual(panelSize.width - surfaceFrame.maxX, surfaceFrame.minX)
        XCTAssertEqual(panelSize.height - surfaceFrame.maxY, surfaceFrame.minY)
        // Padding must clear the corner treatment, or the shadow reads as a box.
        XCTAssertGreaterThan(surfaceFrame.minX, surface.cornerRadius)
    }
}
