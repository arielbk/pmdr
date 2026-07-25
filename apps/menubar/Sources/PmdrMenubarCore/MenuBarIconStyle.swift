import Foundation

/// How the brand mark should be drawn in the menu bar for a given `Status`.
///
/// The menu-bar title is only `M:SS`, so it cannot tell a focus block from a
/// break or a running timer from a paused one. This carries that distinction on
/// the mark itself, along two channels that survive a 19 pt monochrome template
/// image: silhouette weight for the phase, and dimming for paused.
///
/// Colour is deliberately not one of those channels — tinting would cost the
/// template rendering that makes the mark adapt to light/dark, wallpaper
/// tinting, translucency and increased contrast, and phase would then be
/// encoded in the one channel colour-blind users cannot read. `muted` for
/// paused mirrors `FloatingTimerViewModel.PhaseColor`.
public struct MenuBarIconStyle: Equatable, Hashable, Sendable {
    /// Silhouette weight — the only difference that still reads at menu-bar size.
    public enum Weight: Equatable, Hashable, Sendable {
        case outline
        case filled
    }

    public let weight: Weight
    public let isDimmed: Bool
    /// Weight and dimming are visual-only channels, so the state has to be said
    /// out loud as well for anyone reading the menu bar through VoiceOver.
    public let accessibilityLabel: String

    public init(status: Status) {
        switch status {
        case .idle:
            weight = .outline
            isDimmed = false
            accessibilityLabel = "pmdr — idle"
        case .running(let active):
            weight = Self.weight(for: active.phase)
            isDimmed = false
            accessibilityLabel = "pmdr — \(active.phase.rawValue)"
        case .paused(let active):
            weight = Self.weight(for: active.phase)
            isDimmed = true
            accessibilityLabel = "pmdr — \(active.phase.rawValue), paused"
        }
    }

    /// Focus is the state with presence, so it takes the solid mark; a break is
    /// the lighter one and stays an outline.
    private static func weight(for phase: Phase) -> Weight {
        phase == .focus ? .filled : .outline
    }
}
