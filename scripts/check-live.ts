import { createKiroUsageSource } from "../server/kiro";
import { createAntigravityUsageSource } from "../server/antigravity";

// Explicit, read-only live check. Never print credentials, account IDs or store contents.
for (const source of [createKiroUsageSource(), createAntigravityUsageSource()]) {
  const accounts = await source.discover({ kind: "global" });
  console.log(`${source.label}: ${accounts.length} login(s)`);
  for (const account of accounts) {
    const report = await source.fetch(account.input);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "available") process.exitCode = 1;
  }
  if (!accounts.length) process.exitCode = 1;
}
