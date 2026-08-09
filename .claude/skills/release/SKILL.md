---
name: release
description: Cut a new release of @arielbk/pmdr — stamp the version, publish to npm, tag, and create the GitHub release. Use when the user says "create a release", "cut a release", "release pmdr", "publish a new version", or "bump and publish". Maintainer-only; this repo's release flow lives in apps/cli/src/release.ts.
---

# Release @arielbk/pmdr

Cut a new release: stamp the version, build, publish to npm, then tag and
create the GitHub release.

## ⚠️ The one rule: a release is one version

**Decide the exact version up front, stamp it into both manifests first, and
pass that same `--version X.Y.Z` to every later command — the app zip build,
the dry-run, and the real publish. Never use `--bump` after a dry-run.**

There is one number per release. The CLI package version, the
`MARKETING_VERSION` in `apps/menubar/project.yml`, and the version baked into
the bundled `pmdr-app.zip` must all be that number, and `release:pmdr` refuses
to stamp or publish unless all three agree. Any two agreeing is not enough: a
zip that matches its sources but not the released version ships an app a
release behind, and because `pmdr app install` only moves users to a *newer*
app, every user stays pinned to the stale one with the CLI calling it up to
date.

That is why step 1 is `pnpm release:version X.Y.Z` — it writes the number into
both manifests *before* the app is built, so the zip bakes in the right
version and the gate passes. Building the zip before stamping bakes in the old
one and the release will refuse it.

Also: `release:pmdr` *stamps the version into the working tree even on
`--dry-run`* (only the final `npm publish` is gated by the flag). So a dry-run
with `--bump minor` leaves `package.json` at the bumped version — and a second
`--bump minor` reads that stamped value and bumps *again*, skipping a version.
`--version X.Y.Z` is idempotent: re-running it stamps the same value no matter
the working-tree state.

## Steps

1. **Confirm the current published version** (don't trust the working tree — a
   dry-run may have already stamped it):

   ```sh
   npm view @arielbk/pmdr version
   ```

2. **Pick the exact next version.** Feature work → minor; fixes only → patch.
   Look at commits since the last release to decide:

   ```sh
   git log "$(git describe --tags --abbrev=0)"..HEAD --oneline
   ```

3. **Confirm npm auth** is the right account:

   ```sh
   npm whoami   # expect: arielbk
   ```

4. **Stamp the version into both manifests** — this comes before anything is
   built:

   ```sh
   pnpm release:version X.Y.Z
   ```

   Writes `X.Y.Z` into `apps/cli/package.json` and into `MARKETING_VERSION` in
   `apps/menubar/project.yml`, and prints both paths. It is idempotent, so
   re-running it after a dry-run is safe.

5. **Build the app zip from the stamped sources** (or download the CI one, as
   long as CI built it from this same stamped commit):

   ```sh
   pnpm menubar:zip
   # or: gh run download --name pmdr-app --dir apps/cli/bundled-app
   ```

   For a deliberate CLI-only release, skip this and pass `--allow-missing-app`
   to both commands below.

6. **Dry-run** with the exact version. Verify the tarball builds and the
   reported version matches what you picked:

   ```sh
   pnpm release:pmdr -- --dry-run --version X.Y.Z
   ```

7. **Publish** with the *same* exact version:

   ```sh
   pnpm release:pmdr -- --version X.Y.Z
   ```

   This stamps `apps/cli/package.json`, builds the CLI, `npm pack`s to
   `dist/releases/`, and runs `npm publish --access public`.

8. **Verify it landed** (npm view is cached — bust it if it lags):

   ```sh
   npm view @arielbk/pmdr version --cache /tmp/npmcache-bust
   ```

9. **Commit, tag, push** — the stamped manifests are part of the release commit:

   ```sh
   git add -A && git commit -m "chore: release X.Y.Z"
   git tag vX.Y.Z
   git push origin main && git push origin vX.Y.Z
   ```

10. **Create the GitHub release** with notes grouped by theme (highlights,
    fixes, docs), not a raw commit dump:

    ```sh
    gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes> --latest
    ```

## Notes

- `release:pmdr` does **not** commit, tag, or create a GitHub release — those
  are manual steps 9–10.
- `release:pmdr` stamps only `apps/cli/package.json`; it never touches
  `MARKETING_VERSION`. Stamping the menubar sources is step 4's job, which is
  why it has to happen before the zip is built.
- A prerelease version (`0.4.0-beta.1`) is refused whenever an app zip is
  present. Prereleases are CLI-only: build no zip and pass
  `--allow-missing-app`.
- npm versions are immutable; you can't re-publish a number. If you ship the
  wrong version, don't unpublish — just continue with that number (gaps are
  harmless) and tell the user.
- The root `package.json` is `private` with no version; the published package
  is `apps/cli/package.json` (`@arielbk/pmdr`). The bare name `pmdr` on npm
  belongs to someone else — this package is always the scoped name.
