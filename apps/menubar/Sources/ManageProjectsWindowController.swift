import AppKit
import Foundation
import PmdrMenubarCore

/// Modeless window listing every project with archive/unarchive controls.
/// Reuses the existing `PmdrClient` so all mutations route through the CLI.
final class ManageProjectsWindowController: NSWindowController, NSTableViewDataSource, NSTableViewDelegate {
    private let client: PmdrClient
    private let onProjectsChanged: ([ProjectRecord]) -> Void
    private var projects: [ProjectRecord] = []
    private var showArchived: Bool = true
    private var tableView: NSTableView!
    private var showArchivedCheckbox: NSButton!
    private var emptyLabel: NSTextField!

    init(client: PmdrClient, onProjectsChanged: @escaping ([ProjectRecord]) -> Void = { _ in }) {
        self.client = client
        self.onProjectsChanged = onProjectsChanged
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 360),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Manage Projects"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        buildContentView()
        refresh()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func show() {
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refresh()
    }

    // MARK: - Layout

    private func buildContentView() {
        guard let window else { return }
        let content = NSView(frame: window.contentLayoutRect)
        content.autoresizingMask = [.width, .height]

        let checkbox = NSButton(checkboxWithTitle: "Show archived", target: self, action: #selector(toggleShowArchived(_:)))
        checkbox.translatesAutoresizingMaskIntoConstraints = false
        checkbox.state = showArchived ? .on : .off
        content.addSubview(checkbox)
        showArchivedCheckbox = checkbox

        let scrollView = NSScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder

        let table = NSTableView()
        table.dataSource = self
        table.delegate = self
        table.rowHeight = 28
        table.usesAlternatingRowBackgroundColors = true
        table.allowsColumnReordering = false
        table.allowsColumnResizing = true
        table.headerView = NSTableHeaderView()

        let nameColumn = NSTableColumn(identifier: .init("name"))
        nameColumn.title = "Project"
        nameColumn.width = 240
        nameColumn.minWidth = 100
        table.addTableColumn(nameColumn)

        let actionColumn = NSTableColumn(identifier: .init("action"))
        actionColumn.title = ""
        actionColumn.width = 120
        actionColumn.minWidth = 110
        table.addTableColumn(actionColumn)

        scrollView.documentView = table
        content.addSubview(scrollView)
        tableView = table

        let empty = NSTextField(labelWithString: "No projects yet.")
        empty.translatesAutoresizingMaskIntoConstraints = false
        empty.textColor = .secondaryLabelColor
        empty.alignment = .center
        empty.isHidden = true
        content.addSubview(empty)
        emptyLabel = empty

        NSLayoutConstraint.activate([
            checkbox.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            checkbox.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            scrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            scrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            scrollView.topAnchor.constraint(equalTo: checkbox.bottomAnchor, constant: 12),
            scrollView.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -16),
            empty.centerXAnchor.constraint(equalTo: scrollView.centerXAnchor),
            empty.centerYAnchor.constraint(equalTo: scrollView.centerYAnchor),
        ])

        window.contentView = content
    }

    // MARK: - Actions

    @objc private func toggleShowArchived(_ sender: NSButton) {
        showArchived = sender.state == .on
        refresh()
    }

    @objc private func archiveAction(_ sender: NSButton) {
        guard let project = projectForButton(sender) else { return }
        sender.isEnabled = false
        Task { [weak self] in
            guard let self else { return }
            do {
                if project.archived {
                    try await client.unarchiveProject(project.name)
                } else {
                    try await client.archiveProject(project.name)
                }
            } catch {
                await MainActor.run { self.surface(error: error) }
            }
            await MainActor.run { self.refresh() }
        }
    }

    private func projectForButton(_ button: NSButton) -> ProjectRecord? {
        let row = tableView.row(for: button)
        guard row >= 0, row < projects.count else { return nil }
        return projects[row]
    }

    private func refresh() {
        Task { [weak self] in
            guard let self else { return }
            do {
                let fetched = try await client.listProjects(includeArchived: true)
                await MainActor.run {
                    self.projects = self.showArchived ? fetched : fetched.filter { !$0.archived }
                    self.emptyLabel.isHidden = !self.projects.isEmpty
                    self.tableView.reloadData()
                    self.onProjectsChanged(fetched)
                }
            } catch {
                await MainActor.run { self.surface(error: error) }
            }
        }
    }

    private func surface(error: Error) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Project action failed"
        alert.informativeText = String(describing: error)
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: - NSTableViewDataSource

    func numberOfRows(in tableView: NSTableView) -> Int { projects.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard let column = tableColumn, row < projects.count else { return nil }
        let project = projects[row]

        switch column.identifier.rawValue {
        case "name":
            let identifier = NSUserInterfaceItemIdentifier("nameCell")
            let cell = tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView
                ?? nameCell(identifier: identifier)
            cell.textField?.stringValue = project.name
            cell.textField?.textColor = project.archived ? .tertiaryLabelColor : .labelColor
            return cell
        case "action":
            let identifier = NSUserInterfaceItemIdentifier("actionCell")
            let container = tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView
                ?? actionCell(identifier: identifier)
            if let button = container.subviews.compactMap({ $0 as? NSButton }).first {
                button.title = project.archived ? "Unarchive" : "Archive"
                button.target = self
                button.action = #selector(archiveAction(_:))
                button.isEnabled = true
            }
            return container
        default:
            return nil
        }
    }

    private func nameCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier
        let label = NSTextField(labelWithString: "")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.lineBreakMode = .byTruncatingTail
        cell.addSubview(label)
        cell.textField = label
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 4),
            label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -4),
            label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }

    private func actionCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier
        let button = NSButton(title: "Archive", target: nil, action: nil)
        button.bezelStyle = .rounded
        button.controlSize = .small
        button.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(button)
        NSLayoutConstraint.activate([
            button.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -4),
            button.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }
}
