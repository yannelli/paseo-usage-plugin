# Releases

The release flow follows [yannelli/paseo-plugin-concise](https://github.com/yannelli/paseo-plugin-concise): Conventional Commits, synchronized manifest versions, annotated Git tags, and GitHub releases. Releases also publish the public npm package [`@yannelli/paseo-usage-plugin`](https://www.npmjs.com/package/@yannelli/paseo-usage-plugin).

## Automatic versioning

On a push to `main`, the Release workflow installs dependencies, typechecks, and runs the offline tests before publishing. GitHub publication uses `GITHUB_TOKEN` with `contents: write`; npm uses OIDC with `id-token: write` and the repository's trusted publisher. No npm token secret is needed. Release runs are serialized.

The first release uses the version already in `package.json` (`0.1.0`). Later releases select the highest change since the previous stable tag:

| Commit | Change |
| --- | --- |
| `fix:`, `perf:`, `revert:` | Patch |
| `feat:` | Minor |
| `feat!:`, any `!` type, or `BREAKING CHANGE:` footer | Major, including before 1.0 |
| `docs:`, `chore:`, `ci:` without a breaking marker | No version bump |

Use Conventional Commits in commits and squash-merge titles. The workflow updates the package and lockfile versions, pushes the release commit and tag atomically, and creates release notes. It then checks out the exact release tag, packs once, publishes that tarball to npm with provenance, and attaches the same `.tgz` to GitHub.

## Preview

From a clean `main` checkout:

```sh
git fetch --tags
npm run release:dry-run
```

This prints the next version and notes without editing files, tagging, pushing, or contacting GitHub. A non-main branch, dirty worktree, or version mismatch fails before publication.

## Recover an interrupted release

Rerun the **Release** workflow from Actions. The annotated tag stores release notes with a marker, so a rerun can finish GitHub publication after a successful tag push. Existing releases are not duplicated. An npm version is skipped only when its integrity matches the packed release; lookup failures stop the workflow. Attaching the package replaces an incomplete asset.

Documentation-only runs also use the existing release tag for npm and GitHub assets, so unreleased changes cannot replace a tagged package. See [npm publishing](npm-publishing.md) for setup and recovery details.

The separate **Checks** workflow validates Node 22 and 24 and renders the graphics. No credentials or live quota requests are needed in CI.

## Install a release

```sh
paseo plugin install npm:@yannelli/paseo-usage-plugin
```

Alternatively, install `git:yannelli/paseo-usage-plugin` with `--ref <release-tag>` for a fixed GitHub release. An ordinary Git install follows the repository's default branch on update.
