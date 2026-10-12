![Paseo Usage: know what’s left. Kiro credits and Antigravity quotas, right inside Paseo.](docs/images/github-banner.png)

# Paseo Usage Plugin

[![Checks](https://github.com/yannelli/paseo-usage-plugin/actions/workflows/checks.yml/badge.svg)](https://github.com/yannelli/paseo-usage-plugin/actions/workflows/checks.yml)
[![Release](https://img.shields.io/github/v/release/yannelli/paseo-usage-plugin?color=ff4a24&label=release)](https://github.com/yannelli/paseo-usage-plugin/releases)
[![Paseo 0.11.2+](https://img.shields.io/badge/Paseo-0.11.2%2B-18191d)](https://paseo.sh)
[![MIT license](https://img.shields.io/badge/license-MIT-18191d)](LICENSE)

**Kiro credits. Antigravity quotas. One Usage view.**

`paseo-usage-plugin` brings the account limits from **Kiro CLI (AWS)** and **Antigravity CLI (`agy`)** into Paseo's built-in Usage view and matching agent popovers. It uses the CLI accounts you already signed in with.

| Provider | What you see |
| --- | --- |
| **Kiro CLI** | Used and remaining credits, plan, reset date, active trial and bonus balances, reported overage charges |
| **Antigravity** | Shared five-hour and weekly limits for Gemini and other model groups, with reset times and legacy per-model fallback |

## Install

```sh
paseo plugin install git:yannelli/paseo-usage-plugin
```

Enable plugins in **Settings → Plugins**, then open **Usage**. Sign in to each CLI on the **daemon host**, where this plugin runs.

Requires **Paseo 0.11.2+** and **Node 22.13+**. Tested on Linux with Kiro CLI **2.29.1** and Antigravity CLI **1.3.3**. Paseo supplies all runtime dependencies.

```sh
paseo plugin ls paseo-usage-plugin
paseo plugin update paseo-usage-plugin
```

For a specific release, add `--ref v0.1.0` to the install command.

## The numbers that matter

![Illustrated Kiro credit balance and Antigravity shared quota reports with sample data.](docs/images/quota-preview.png)

*Graphics are illustrations with sample data, not product screenshots. The actual layout is provided by Paseo.*

- **Account limits, where you work.** The same usage sources feed the host-wide Usage view and the corresponding agent's popover.
- **The right account for each agent.** Session discovery follows the agent's launch environment. Stable account keys survive token rotation.
- **Reset times from the provider.** Reported five-hour and weekly periods stay distinct. Unknown periods are not guessed from a countdown.
- **Existing logins, read-only.** The plugin reads stored access tokens. It never refreshes them, changes login files, or starts an agent.
- **Useful failure states.** Expired or rejected logins show a remedy. An account error does not prevent other accounts from reporting usage.

## Configuration

Default credential locations on Linux:

| Provider | Store | Optional override |
| --- | --- | --- |
| Kiro | `~/.local/share/kiro-cli/data.sqlite3` (respects `XDG_DATA_HOME`) | `KIRO_USAGE_DB` |
| Antigravity | `~/.gemini/antigravity-cli/antigravity-oauth-token` | `AGY_USAGE_TOKEN_FILE` |

Overrides are absolute file paths in the daemon or agent's launch environment. They select a store for this plugin; they do not change the CLI's login. Usage is cached by Paseo for five minutes, with manual refresh available.

The supported accounts are local CLI OAuth logins. API-key/ADC accounts, remote Antigravity language servers, custom gateways, and IDE-only credentials are not supported. These are internal CLI quota endpoints, so future upstream changes may require adapter updates.

[Credential details, quota semantics, and troubleshooting →](docs/configuration.md)

## Development

```sh
git clone https://github.com/yannelli/paseo-usage-plugin.git
cd paseo-usage-plugin
npm ci
npm run check
paseo plugin install "$PWD"
```

`npm run check` runs typechecking and the offline tests. `npm run check:live` explicitly fetches the configured accounts' real quotas. After changes, run `paseo plugin reload paseo-usage-plugin`.

| Guide | Contents |
| --- | --- |
| [Configuration](docs/configuration.md) | Credential stores, account isolation, request behavior, troubleshooting |
| [Development](docs/development.md) | Validation, packaging, local testing, reproducible graphics |
| [Releases](docs/releases.md) | Conventional Commits, automatic GitHub releases, versioning |

## Releases and license

Checks run on Node 22 and 24. Qualifying pushes to `main` create a versioned GitHub release and attach an installable package. `fix:` makes a patch release, `feat:` makes a minor release, and a breaking change makes a major release. Documentation-only changes do not bump the version. [Release details →](docs/releases.md)

[MIT](LICENSE) · Made by [Ryan Yannelli](https://ryanyannelli.com). Questions or feedback? [Open an issue](https://github.com/yannelli/paseo-usage-plugin/issues).
