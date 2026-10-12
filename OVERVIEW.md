Adds Kiro CLI and Antigravity CLI account usage to Paseo's Usage view and matching agents' usage popovers.

Kiro shows used and remaining credits, the plan name, reset dates, active trial and bonus balances, and reported overage charges. Antigravity shows the shared five-hour and weekly limits returned by Google, with model quota fallback for older responses.

Requires Paseo 0.11.2 or later, a daemon running Node 22.13 or later, and an existing CLI login on the daemon host. Tested on Linux with Kiro CLI 2.29.1 and Antigravity CLI 1.3.3. Uses the existing Kiro SQLite login store and Antigravity OAuth token file. No separate API key is needed.

The plugin reads credentials and sends authenticated quota requests to AWS CodeWhisperer and Google Cloud Code. It never refreshes tokens, writes login stores, or runs agents. Expired credentials must be refreshed by the owning CLI. Paseo provides caching and manual refresh.

Only local CLI OAuth accounts are supported. Custom credential paths can be selected with KIRO_USAGE_DB and AGY_USAGE_TOKEN_FILE on the daemon or session environment. These settings affect this plugin; configure the CLI to use the same account separately. The quota endpoints are internal CLI APIs and may change with future CLI versions.
