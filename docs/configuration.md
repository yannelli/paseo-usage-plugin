# Configuration and quota behavior

## Credential stores

| Source | Default store | Optional plugin override |
| --- | --- | --- |
| Kiro | `$XDG_DATA_HOME/kiro-cli/data.sqlite3`, defaulting to `~/.local/share/kiro-cli/data.sqlite3` | `KIRO_USAGE_DB` (absolute file path) |
| Antigravity | `~/.gemini/antigravity-cli/antigravity-oauth-token` | `AGY_USAGE_TOKEN_FILE` (absolute file path) |

The default stores are the Linux paths tested here. On a system with a different layout, set the corresponding override to its actual CLI credential store. For host-wide Usage, set overrides in the daemon's environment. For individual agents, set them in the provider's launch environment and point them at that agent's actual account. These are plugin settings, not CLI settings; they do not change which account the CLI uses.

Session discovery uses the session's resolved environment, including `HOME` and Kiro's `XDG_DATA_HOME`. It never searches the daemon's other accounts as a fallback. Kiro supports the `kirocli:social:token` and `kirocli:odic:token` database entries. Antigravity supports its local CLI OAuth file, not IDE credentials, API-key/ADC accounts, remote language servers, or custom gateways.

Tokens are read again on every fetch so CLI token rotations are picked up. The plugin opens Kiro's database read-only, never writes credentials, and never redeems refresh tokens. An expired or rejected login appears with Paseo's remedy for the owning CLI. Open/authenticate that CLI, then refresh Usage.

Only store locators cross the plugin usage interface. Credentials are sent only to the corresponding AWS or Google quota endpoint, and are never included in reports or logs. HTTP redirects are rejected. The plugin does not read conversation history or submit agent prompts.

## Quota behavior

Paseo owns the five-minute fetch cache and manual refresh. Requests have a shared 15-second deadline per source fetch, below Paseo's 20-second login deadline. An account failure produces an error for that account.

Kiro's precision fields take precedence over rounded values. Each credit pool is shown separately so trial and bonus expiry dates remain visible. The API supplies reset timestamps without a duration, so the window is labeled **Credits**, rather than inferring a monthly period.

Antigravity first calls `retrieveUserQuotaSummary` and uses Google's named buckets and periods. If that endpoint is unavailable (404/501) or supplies no buckets, it falls back to `fetchAvailableModels`. Legacy model quotas are labeled **Rolling** because they lack period metadata. Equal percentages are never used to infer shared quotas. Window IDs stay stable when response order or display names change.

These quota endpoints are internal APIs used by the CLIs, not public versioned SDK contracts. Antigravity currently requires an Antigravity client User-Agent. Future CLI/API changes may require adapter updates.


## Troubleshooting

| Symptom | Check |
| --- | --- |
| No account card | Sign in with the CLI on the daemon host; confirm its store path and file permissions. |
| Expired or rejected login | Open/authenticate the owning CLI, then refresh Usage. The plugin does not redeem refresh tokens. |
| Works globally but not for an agent | Check the agent's provider ID and launch environment. Only that session's account is used. |
| Quota service error | Retry after any upstream rate limit or outage. Errors do not include upstream response bodies or tokens. |
| Store uses a different path | Set the absolute `KIRO_USAGE_DB` or `AGY_USAGE_TOKEN_FILE` path for the relevant scope. |
| Plugin changes are missing | Run `npm run check`, then `paseo plugin reload paseo-usage-plugin`. |

## References

- [Paseo usage source contract](https://paseo.sh/docs/plugins/reference#usage-sources)
- [Kiro billing](https://kiro.dev/docs/billing/)
- [Antigravity usage command](https://www.agy.dev/docs/cli/commands/usage/)
