import AppKit
import PmdrMenubarCore

enum BrandIcon {
    private static func imageName(_ weight: MenuBarIconStyle.Weight) -> NSImage.Name {
        switch weight {
        case .outline: return NSImage.Name("PmdrTomato")
        case .filled: return NSImage.Name("PmdrTomatoFilled")
        }
    }

    /// The asset is a 16 × 18 unit box whose bottom two units are empty padding,
    /// drawn at 1.1875 pt per unit. The padding is what lifts the fruit onto the
    /// timer digits' optical centre once AppKit centres the box on the button.
    static let menuBarSize = NSSize(width: 19, height: 21.375)

    /// Opacity for a paused timer. Matches how `FloatingTimerViewModel` mutes the
    /// panel while paused, so both surfaces read as suspended the same way.
    static let dimmedAlpha: CGFloat = 0.55

    static func templateImage(
        _ weight: MenuBarIconStyle.Weight = .outline,
        size: NSSize = menuBarSize
    ) -> NSImage? {
        guard let source = NSImage(named: imageName(weight)),
              let image = source.copy() as? NSImage else {
            return nil
        }

        image.isTemplate = true
        image.size = size
        return image
    }

    /// Digits carry no descenders, so they sit optically above the midline the
    /// status button centres the mark on. The image's bottom padding closes half
    /// that gap; this drops the label the remaining point, so the timer reads
    /// level with the tomato's body rather than with its calyx.
    private static let titleBaselineOffset: CGFloat = -1

    static func menuBarTitle(_ text: String) -> NSAttributedString {
        NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.menuBarFont(ofSize: 0),
                .foregroundColor: NSColor.labelColor,
                .baselineOffset: titleBaselineOffset,
            ]
        )
    }
}
