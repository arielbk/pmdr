import AppKit

/// The one dark appearance shared by pmdr's floating overlays (the timer panel
/// and the quick-note panel).
///
/// The surface deliberately does *not* use window vibrancy: an overlay blended
/// with whatever sits behind it washes out over light content. Values here are
/// fixed so legibility is a property of the overlay, not of the desktop.
///
/// Values are semantic and centralized so a future light or adaptive theme can
/// be added by introducing another instance — no panel surgery required.
public struct OverlaySurface {
    /// The dark surface used by every production overlay today.
    public static let standard = OverlaySurface()

    public var backgroundColor: NSColor
    public var borderColor: NSColor
    public var borderWidth: CGFloat
    public var cornerRadius: CGFloat
    /// Appearance forced on the surface subtree, so overlay chrome can keep
    /// using semantic colors (`labelColor`, `secondaryLabelColor`, …) and still
    /// resolve them against this fill rather than against the system theme.
    public var appearanceName: NSAppearance.Name
    /// Transparent padding kept between the panel edge and the surface. The
    /// window server derives the shadow from visible pixels, so this padding is
    /// what makes the shadow rounded rather than rectangular.
    public var shadowMargin: CGFloat

    public init(
        backgroundColor: NSColor = NSColor(srgbRed: 0.11, green: 0.11, blue: 0.12, alpha: 0.97),
        borderColor: NSColor = NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.12),
        borderWidth: CGFloat = 1,
        cornerRadius: CGFloat = 14,
        appearanceName: NSAppearance.Name = .darkAqua,
        shadowMargin: CGFloat = 20
    ) {
        self.backgroundColor = backgroundColor
        self.borderColor = borderColor
        self.borderWidth = borderWidth
        self.cornerRadius = cornerRadius
        self.appearanceName = appearanceName
        self.shadowMargin = shadowMargin
    }

    /// Turns `view` into an overlay surface: stable fill, hairline border and
    /// rounded corners.
    @MainActor
    public func apply(to view: NSView) {
        view.appearance = NSAppearance(named: appearanceName)
        view.wantsLayer = true
        guard let layer = view.layer else { return }
        layer.backgroundColor = backgroundColor.cgColor
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
