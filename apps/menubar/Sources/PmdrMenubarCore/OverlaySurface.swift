import AppKit

/// The one dark material shared by pmdr's floating overlays (the timer panel
/// and the quick-note panel).
///
/// A native behind-window material supplies blur and desktop colour bleed. A
/// translucent graphite tint sits above it so bright content cannot wash the
/// surface out. Keeping those two concerns separate gives the overlays depth
/// without making their legibility depend entirely on what is behind them.
///
/// Values are semantic and centralized so a future light or adaptive theme can
/// be added by introducing another instance — no panel surgery required.
public struct OverlaySurface {
    /// The dark surface used by every production overlay today.
    public static let standard = OverlaySurface()
    public static let tintViewIdentifier = NSUserInterfaceItemIdentifier("dev.pmdr.overlay-tint")

    public var tintColor: NSColor
    public var borderColor: NSColor
    public var borderWidth: CGFloat
    public var cornerRadius: CGFloat
    public var material: NSVisualEffectView.Material
    public var blendingMode: NSVisualEffectView.BlendingMode
    public var effectState: NSVisualEffectView.State
    /// Appearance forced on the surface subtree, so overlay chrome can keep
    /// using semantic colors (`labelColor`, `secondaryLabelColor`, …) and still
    /// resolve them against this fill rather than against the system theme.
    public var appearanceName: NSAppearance.Name
    /// Transparent padding kept between the panel edge and the surface. The
    /// window server derives the shadow from visible pixels, so this padding is
    /// what makes the shadow rounded rather than rectangular.
    public var shadowMargin: CGFloat

    public init(
        tintColor: NSColor = NSColor(srgbRed: 0.08, green: 0.085, blue: 0.095, alpha: 0.68),
        borderColor: NSColor = NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.16),
        borderWidth: CGFloat = 1,
        cornerRadius: CGFloat = 16,
        material: NSVisualEffectView.Material = .hudWindow,
        blendingMode: NSVisualEffectView.BlendingMode = .behindWindow,
        effectState: NSVisualEffectView.State = .active,
        appearanceName: NSAppearance.Name = .darkAqua,
        shadowMargin: CGFloat = 20
    ) {
        self.tintColor = tintColor
        self.borderColor = borderColor
        self.borderWidth = borderWidth
        self.cornerRadius = cornerRadius
        self.material = material
        self.blendingMode = blendingMode
        self.effectState = effectState
        self.appearanceName = appearanceName
        self.shadowMargin = shadowMargin
    }

    /// Turns `view` into an overlay surface: active blur, stabilising tint,
    /// hairline border and rounded corners.
    @MainActor
    public func apply(to view: NSVisualEffectView) {
        view.appearance = NSAppearance(named: appearanceName)
        view.material = material
        view.blendingMode = blendingMode
        view.state = effectState
        view.isEmphasized = true
        view.wantsLayer = true
        guard let layer = view.layer else { return }
        // NSVisualEffectView paints its material above its own backgroundColor.
        // Put the stabilising tint in a child view instead, so it composites
        // over the blur and under the overlay's controls.
        let tintView = OverlayTintView(frame: view.bounds)
        tintView.identifier = Self.tintViewIdentifier
        tintView.autoresizingMask = [.width, .height]
        tintView.wantsLayer = true
        tintView.layer?.backgroundColor = tintColor.cgColor
        view.addSubview(tintView)

        layer.borderColor = borderColor.cgColor
        layer.borderWidth = borderWidth
        layer.cornerRadius = cornerRadius
        layer.cornerCurve = .continuous
        layer.masksToBounds = true
    }

    /// Prepares `panel` so the surface — not the window rectangle — is what the
    /// user sees and what the window server casts a shadow from.
    @MainActor
    public func configure(_ panel: NSPanel) {
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
    }

    /// Panel frame size needed to host a surface of `visualSize`, including the
    /// transparent shadow padding.
    public func panelSize(forVisualSize visualSize: NSSize) -> NSSize {
        NSSize(
            width: visualSize.width + shadowMargin * 2,
            height: visualSize.height + shadowMargin * 2
        )
    }

    /// Where the surface view sits inside a panel sized by
    /// `panelSize(forVisualSize:)`.
    public func surfaceFrame(forVisualSize visualSize: NSSize) -> NSRect {
        NSRect(
            x: shadowMargin,
            y: shadowMargin,
            width: visualSize.width,
            height: visualSize.height
        )
    }
}

/// Visual-only tint above the material. Returning no hit-test result keeps the
/// surface draggable and lets controls added above it receive input normally.
private final class OverlayTintView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
