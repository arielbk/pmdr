import AppKit

enum BrandIcon {
    private static let imageName = NSImage.Name("PmdrTomato")

    static func templateImage(
        size: NSSize = NSSize(width: 19, height: 20)
    ) -> NSImage? {
        guard let source = NSImage(named: imageName),
              let image = source.copy() as? NSImage else {
            return nil
        }

        image.isTemplate = true
        image.size = size
        return image
    }
}
