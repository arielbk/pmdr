import AppKit
import Foundation
import PmdrMenubarCore

/// Modeless window listing every project with archive/unarchive controls.
/// Reuses the existing `PmdrClient` so all mutations route through the CLI.
final class ManageProjectsWindowController: NSWindowController, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate {
    private let client: PmdrClient
    private let onProjectsChanged: ([ProjectRecord]) -> Void
    private var projects: [ProjectRecord] = []
    private var showArchived: Bool = true
    private var tableView: NSTableView!
    private var showArchivedCheckbox: NSButton!
    private var emptyLabel: NSTextField!
    private var editingProject: ProjectRecord?

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
        table.target = self
        table.doubleAction = #selector(beginRenaming(_:))

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

    @objc private func beginRenaming(_ sender: NSTableView) {
        let row = sender.clickedRow
        let column = sender.clickedColumn
        guard row >= 0, row < projects.count, column == 0 else { return }
        editingProject = projects[row]
        sender.editColumn(column, row: row, with: nil, select: true)
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
            cell.textField?.delegate = self
            cell.textField?.isEnabled = true
            return cell
        case "action":
            let identifier = NSUserInterfaceItemIdentifier("actionCell")
            let container = tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView
                ?? actionCell(identifier: identifier)
            if let archive = container.subviews.compactMap({ $0 as? NSButton }).first {
                archive.title = project.archived ? "Unarchive" : "Archive"
                archive.target = self
                archive.action = #selector(archiveAction(_:))
                archive.isEnabled = true
            }
            return container
        default:
            return nil
        }
    }

    private func nameCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier
        let field = NSTextField()
        field.isEditable = true
        field.isSelectable = true
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.toolTip = "Double-click to rename"
        field.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(field)
        cell.textField = field
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 4),
            field.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -4),
            field.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }

    private func actionCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier
        let archive = NSButton(title: "Archive", target: nil, action: nil)
        archive.bezelStyle = .rounded
        archive.controlSize = .small
        archive.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(archive)
        NSLayoutConstraint.activate([
            archive.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -4),
            archive.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }

    // MARK: - NSTextFieldDelegate

    func controlTextDidBeginEditing(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        let row = tableView.row(for: field)
        guard row >= 0, row < projects.count else { return }
        editingProject = projects[row]
    }

    func controlTextDidEndEditing(_ notification: Notification) {
        guard
            let field = notification.object as? NSTextField,
            let project = editingProject
        else { return }
        editingProject = nil

        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != project.name else {
            tableView.reloadData()
            return
        }

        field.isEnabled = false
        Task { [weak self] in
            guard let self else { return }
            do {
                try await client.renameProject(project.name, to: name)
            } catch {
                await MainActor.run { self.surface(error: error) }
            }
            await MainActor.run { self.refresh() }
        }
    }
}
