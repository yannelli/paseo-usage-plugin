# npm publishing

The public package is [`@yannelli/paseo-usage-plugin`](https://www.npmjs.com/package/@yannelli/paseo-usage-plugin). Its repository is `yannelli/paseo-usage-plugin`, and its Paseo runtime ID remains `paseo-usage-plugin`.

## Automatic releases

The `.github/workflows/release.yml` workflow runs on pushes to `main` and can also be dispatched manually. After validation and GitHub release creation, it checks out the exact release tag, packs once, publishes the tarball with provenance, and attaches that same file to the GitHub release.

The job runs on a GitHub-hosted Ubuntu runner with Node 24 and npm 12.2.0. It requests `id-token: write` for npm's OIDC exchange and `contents: write` for GitHub releases. `package.json` fixes public access, provenance, and the npm registry. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is required.

Trusted publisher configuration:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Repository owner | `yannelli` |
| Repository | `paseo-usage-plugin` |
| Workflow filename | `release.yml` |
| Environment | None |
| Permission | Publish |

## Initial setup

npm requires the package to exist before adding a trusted publisher. Version `0.1.1` was the initial local publication; subsequent automated releases include provenance. A local bootstrap uses an npm account that can publish under `@yannelli` and browser authorization:

```sh
npm login --auth-type=web
npm publish --access public --provenance=false
```

Do not repeat the bootstrap for an existing version. Local publication disables provenance because npm's provenance generation requires a supported CI environment.

With npm 11.15.0 or later and account two-factor authentication, configure the trust relationship:

```sh
npm trust github @yannelli/paseo-usage-plugin \
  --repo yannelli/paseo-usage-plugin \
  --file release.yml \
  --allow-publish \
  --yes
```

Complete npm's browser authorization if prompted. `--allow-publish` permits direct releases; otherwise new trust configurations may only allow staged publishing. Inspect the configuration with:

```sh
npm trust list @yannelli/paseo-usage-plugin
```

Publish through the configured workflow within npm's activation window (currently two days). The successful automated release verifies the trust relationship.

## Retry and verification

If a run fails after creating the tag or publishing to npm, rerun **Release** from GitHub Actions. A rerun checks out the existing release tag, checks registry metadata, and skips publication only if the version and SHA-512 package integrity match. Authentication, rate-limit, network, malformed metadata, and other registry errors fail the job; they are never treated as a missing version. A contents mismatch requires investigation and a new version, since npm versions are immutable.

```sh
gh workflow run release.yml --repo yannelli/paseo-usage-plugin
npm view @yannelli/paseo-usage-plugin version dist.attestations --json
```

The npm package page links provenance for releases published by GitHub Actions. GitHub release assets contain the identical tarball. Documentation-only commits do not change that tarball or create a new version.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), [npm trust CLI](https://docs.npmjs.com/cli/v12/commands/npm-trust/), and [provenance statements](https://docs.npmjs.com/generating-provenance-statements/).
