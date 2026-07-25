import AppKit
import PmdrMenubarCore

/// One note in the daily history: a system-localized capture time and the note
/// text, clamped to two visual lines.
final class NoteHistoryRowView: NSView {
    static let horizontalInset: CGFloat = 12
    static let verticalInset: CGFloat = 7
    static let timeWidth: CGFloat = 58
    static let timeGap: CGFloat = 10
    static let textFont: NSFont = .systemFont(ofSize: 13, weight: .regular)
    static let maximumLines = 2

    let timeLabel: NSTextField
    let textLabel: NSTextField

    /// Noninteractive, so the whole history area keeps dragging the panel.
    override var mouseDownCanMoveWindow: Bool { true }

    init(note: NoteRecord, time: String, width: CGFloat) {
        timeLabel = NoteHistoryRowView.makeLabel(
            font: .monospacedDigitSystemFont(ofSize: 11, weight: .regular),
            color: .secondaryLabelColor
        )
        timeLabel.stringValue = time
        timeLabel.maximumNumberOfLines = 1

        textLabel = NoteHistoryRowView.makeLabel(
            font: NoteHistoryRowView.textFont,
            color: .labelColor
        )
        textLabel.stringValue = note.text
        textLabel.maximumNumberOfLines = NoteHistoryRowView.maximumLines
        textLabel.lineBreakMode = .byTruncatingTail

        let textWidth = NoteHistoryRowView.textWidth(forRowWidth: width)
        textLabel.preferredMaxLayoutWidth = textWidth
        let textHeight = NoteHistoryRowView.textHeight(for: note.text, width: textWidth)
        let height = textHeight + NoteHistoryRowView.verticalInset * 2

        super.init(frame: NSRect(x: 0, y: 0, width: width, height: height))

        addSubview(timeLabel)
        addSubview(textLabel)
        timeLabel.frame = NSRect(
            x: NoteHistoryRowView.horizontalInset,
            y: NoteHistoryRowView.verticalInset,
            width: NoteHistoryRowView.timeWidth,
            height: 15
        )
        textLabel.frame = NSRect(
            x: NoteHistoryRowView.horizontalInset + NoteHistoryRowView.timeWidth + NoteHistoryRowView.timeGap,
            y: NoteHistoryRowView.verticalInset,
            width: textWidth,
            height: textHeight
        )
        // Timestamps sit on the first line of a wrapped note, not centred on it.
        timeLabel.frame.origin.y = height - NoteHistoryRowView.verticalInset - timeLabel.frame.height
        textLabel.frame.origin.y = height - NoteHistoryRowView.verticalInset - textHeight
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    static func textWidth(forRowWidth width: CGFloat) -> CGFloat {
        width - horizontalInset * 2 - timeWidth - timeGap
    }

    static var lineHeight: CGFloat {
        ceil(textFont.ascender - textFont.descender + textFont.leading)
    }

    /// The rendered height of the note, never more than `maximumLines` lines.
    /// The text is measured wrapped at `width`; the clamp is what turns anything
    /// longer into a two-line, tail-truncated row.
    static func textHeight(for text: String, width: CGFloat) -> CGFloat {
        let wrapped = (text as NSString).boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: textFont]
        )
        let fitted = ceil(wrapped.height)
        return min(max(fitted, lineHeight), lineHeight * CGFloat(maximumLines))
    }

    private static func makeLabel(font: NSFont, color: NSColor) -> NSTextField {
        let label = NSTextField(labelWithString: "")
        label.font = font
        label.textColor = color
        label.isBordered = false
        label.drawsBackground = false
        label.isEditable = false
        label.isSelectable = false
        label.usesSingleLineMode = false
        label.cell?.wraps = true
        label.cell?.isScrollable = false
        return label
    }
}

/// Scrollable list of today's notes, newest first, shown beneath the capture
/// input when the `Today · N` control is activated.
final class NoteHistoryListView: NSScrollView {
    /// The list never grows past this; beyond it, the notes scroll.
    static let maximumHeight: CGFloat = 220

    private let listContentView = FlippedContentView()
    private(set) var rows: [NoteHistoryRowView] = []
    private(set) var placeholderLabel: NSTextField?

    override var mouseDownCanMoveWindow: Bool { true }

    init(width: CGFloat) {
        super.init(frame: NSRect(x: 0, y: 0, width: width, height: 0))
        drawsBackground = false
        borderType = .noBorder
        hasVerticalScroller = true
        hasHorizontalScroller = false
        autohidesScrollers = true
        verticalScrollElasticity = .allowed
        horizontalScrollElasticity = .none
        scrollerStyle = .overlay
        contentView.drawsBackground = false
        listContentView.frame = NSRect(x: 0, y: 0, width: width, height: 0)
        documentView = listContentView
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// Empties the list; used when history collapses so nothing is retained
    /// behind a hidden view.
    func clear() {
        rows.forEach { $0.removeFromSuperview() }
        rows = []
        placeholderLabel?.removeFromSuperview()
        placeholderLabel = nil
        listContentView.frame = NSRect(x: 0, y: 0, width: frame.width, height: 0)
    }

    /// Renders `notes` (nil meaning "could not be read") and returns the height
    /// the list wants — its content height, capped at `maximumHeight`.
    @discardableResult
    func update(notes: [NoteRecord]?, width: CGFloat, time: (Date) -> String) -> CGFloat {
        rows.forEach { $0.removeFromSuperview() }
        rows = []
        placeholderLabel?.removeFromSuperview()
        placeholderLabel = nil

        var contentHeight: CGFloat = 0
        if let notes, !notes.isEmpty {
            for note in NoteHistory.newestFirst(notes) {
                let row = NoteHistoryRowView(
                    note: note,
                    time: time(NoteHistory.date(forEpochMilliseconds: note.at)),
                    width: width
                )
                row.frame.origin = NSPoint(x: 0, y: contentHeight)
                listContentView.addSubview(row)
                rows.append(row)
                contentHeight += row.frame.height
            }
        } else {
            let label = NSTextField(labelWithString: notes == nil ? "Notes unavailable" : "No notes yet")
            label.font = .systemFont(ofSize: 12, weight: .regular)
            label.textColor = .secondaryLabelColor
            label.frame = NSRect(
                x: NoteHistoryRowView.horizontalInset,
                y: NoteHistoryRowView.verticalInset,
                width: width - NoteHistoryRowView.horizontalInset * 2,
                height: 16
            )
            listContentView.addSubview(label)
            placeholderLabel = label
            contentHeight = label.frame.height + NoteHistoryRowView.verticalInset * 2
        }

        listContentView.frame = NSRect(x: 0, y: 0, width: width, height: contentHeight)
        return min(contentHeight, Self.maximumHeight)
    }

    /// True once the notes no longer fit the visible list and must be scrolled.
    var isScrollable: Bool {
        (documentView?.frame.height ?? 0) > contentSize.height + 0.5
    }
}

/// Notes read top-down, so the list's content view is flipped.
private final class FlippedContentView: NSView {
    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { true }
}
