## `config-read` — 2026-06-04 01:03:41

**Status:** done
**Summary:** Added effective config reads for the CLI, including defaults, partial-file merging, per-key invalid-value fallback, `pmdr config --json`, and `pmdr config get <key>`.
**Deviations:** none.
**Handoff:** Config reads use `XDG_CONFIG_HOME/pmdr/config.json` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/pmdr/config.json`. The public read module currently preserves only known config keys; the later `config-set` slice must preserve unknown keys during read-modify-write.
