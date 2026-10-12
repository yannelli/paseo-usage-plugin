# Releases

The release flow follows [yannelli/paseo-plugin-concise](https://github.com/yannelli/paseo-plugin-concise): Conventional Commits, synchronized manifest versions, annotated Git tags, and GitHub releases. This repository distributes through GitHub; it does not publish an npm package.

## Automatic versioning

On a push to `main`, the Release workflow installs dependencies, typechecks, and runs the offline tests before publishing. It uses only the repository's `GITHUB_TOKEN` with `contents: write`. Release runs are serialized.

The first release uses the version already in `package.json` (`0.1.0`). Later releases select the highest change since the previous stable tag:

| Commit | Change |
| --- | --- |
| `fix:`, `perf:`, `revert:` | Patch |
| `feat:` | Minor |
| `feat!:`, any `!` type, or `BREAKING CHANGE:` footer | Major, including before 1.0 |
| `docs:`, `chore:`, `ci:` without a breaking marker | No version bump |

Use Conventional Commits in commits and squash-merge titles. The workflow updates the package and lockfile versions, pushes the release commit and tag atomically, creates release notes, and attaches an installable `.tgz`.

## Preview

From a clean `main` checkout:

```sh
git fetch --tags
npm run release:dry-run
```

This prints the next version and notes without editing files, tagging, pushing, or contacting GitHub. A non-main branch, dirty worktree, or version mismatch fails before publication.

## Recover an interrupted release

Rerun the **Release** workflow from Actions. The annotated tag stores release notes with a marker, so a rerun can finish GitHub publication after a successful tag push. Existing releases are not duplicated; attaching the package replaces an incomplete asset.

The separate **Checks** workflow validates Node 22 and 24 and renders the graphics. No credentials or live quota requests are needed in CI.

## Install a release

```sh
paseo plugin install git:yannelli/paseo-usage-plugin --ref v0.1.1
```

An ordinary Git install follows the repository's default branch on update. Use a tag explicitly when a fixed release is desired.
