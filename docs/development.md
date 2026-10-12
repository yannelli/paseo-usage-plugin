# Development

Use the Node version in `.nvmrc` for development. The usage sources also support Node 22.13 and later; CI tests the latest Node 22 and 24 releases.

```sh
npm ci
npm run check
paseo plugin install "$PWD"
```

The server entry registers `kiro` and `antigravity` usage sources. Paseo owns rendering, grouping, and the fetch cache. There is no client bundle or separate dashboard.

## Validation

`npm run check` runs TypeScript and the Node test runner. Adapter tests use temporary SQLite/JSON stores and mocked HTTP responses. Release tests use temporary Git repositories and a local HTTP server. No test requires a real CLI login or GitHub token.

Coverage includes quota precision, active/expired credit pools, unknown limits, protobuf defaults, stable quota IDs, session isolation, token rotation, unchanged credential files, malformed data, rejected credentials, HTTP fallback, version drift, interrupted release recovery, and npm publication retry checks.

```sh
# Explicitly query real local accounts; prints quota reports, not tokens.
npm run check:live
# Reload only this plugin after editing.
paseo plugin reload paseo-usage-plugin
paseo plugin logs paseo-usage-plugin
```

## Package contents

```sh
npm pack --dry-run
```

The package includes the plugin manifest, server entry and adapters, icon, overview, README, documentation, and promotional PNGs. Tests, renderer sources, fonts, and development dependencies stay out of the installed package. Paseo provides the plugin SDK and Zod; Node provides SQLite and fetch.

The npm package name is `@yannelli/paseo-usage-plugin`; the Paseo manifest ID is `paseo-usage-plugin`. The [release workflow](releases.md) packs the exact release tag and sends that same tarball to npm and GitHub. See [npm publishing](npm-publishing.md) for authentication and provenance.

## Graphics

The graphics are original HTML/CSS illustrations, inspired by the charcoal, cream, and orange presentation of [Be Concise for Paseo](https://github.com/yannelli/paseo-plugin-concise). They use invented sample values, with no real account names, credentials, or screenshots of private sessions.

```sh
npx playwright install chromium
npm run graphics
```

The renderer checks fonts, image loading, card bounds, dimensions, and a 700 KB limit per promotional image. It creates:

| Asset | Size | Purpose |
| --- | --- | --- |
| `docs/images/github-banner.png` | 1920 × 1080 | README and Paseo plugin media |
| `docs/images/quota-preview.png` | 1920 × 1080 | Illustrated quota reports |
| `docs/images/social-preview.png` | 1280 × 640 | GitHub social preview upload |
| `assets/icon.png` | 512 × 512 | Plugin catalog icon |

Edit `docs/graphics/banner.html` and `assets/icon.svg`, then regenerate and inspect the resulting images before committing. Fonts are bundled under the [SIL Open Font License](graphics/fonts/OFL.txt); the rest of the project uses MIT.

GitHub's custom social preview is uploaded through the repository's Settings page. The ready-to-upload file is included above; it is separate from the README banner and Paseo plugin media.
