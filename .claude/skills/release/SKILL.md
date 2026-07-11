---
name: release
description: Cut a new release of @arielbk/pmdr — stamp the version, publish to npm, tag, and create the GitHub release. Use when the user says "create a release", "cut a release", "release pmdr", "publish a new version", or "bump and publish". Maintainer-only; this repo's release flow lives in apps/cli/src/release.ts.
---

# Release @arielbk/pmdr

Cut a new release: stamp the version, build, publish to npm, then tag and
create the GitHub release.

## ⚠️ The one rule that prevents the careless mistake

**Decide the exact version up front and pass `--version X.Y.Z` to BOTH the
dry-run and the real publish. Never use `--bump` after a dry-run.**

Why: `release:pmdr` *stamps the version into the working tree even on
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

4. **Dry-run** with the exact version. Verify the tarball builds and the
   reported version matches what you picked:

   ```sh
   pnpm release:pmdr -- --dry-run --version X.Y.Z
   ```

5. **Publish** with the *same* exact version:

   ```sh
   pnpm release:pmdr -- --version X.Y.Z
   ```

   This stamps `apps/cli/package.json`, builds the CLI, `npm pack`s to
   `dist/releases/`, and runs `npm publish --access public`.

6. **Verify it landed** (npm view is cached — bust it if it lags):

   ```sh
   npm view @arielbk/pmdr version --cache /tmp/npmcache-bust
   ```

7. **Commit, tag, push:**

   ```sh
   git add -A && git commit -m "chore: release X.Y.Z"
   git tag vX.Y.Z
   git push origin main && git push origin vX.Y.Z
   ```

8. **Create the GitHub release** with notes grouped by theme (highlights,
   fixes, docs), not a raw commit dump:

   ```sh
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes> --latest
   ```

## Notes

- `release:pmdr` does **not** commit, tag, or create a GitHub release — those
  are manual steps 7–8.
- npm versions are immutable; you can't re-publish a number. If you ship the
  wrong version, don't unpublish — just continue with that number (gaps are
  harmless) and tell the user.
- The root `package.json` is `private` with no version; the published package
  is `apps/cli/package.json` (`@arielbk/pmdr`). The bare name `pmdr` on npm
  belongs to someone else — this package is always the scoped name.
