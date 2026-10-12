import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createKiroUsageSource, parseKiroUsage } from "../server/kiro";
import { createAntigravityUsageSource, parseAntigravityModels, parseAntigravitySummary } from "../server/antigravity";
import { requestJson, type Fetcher } from "../server/common";
import type { UsageReport } from "@getpaseo/plugin/server/usage";

const NOW = Date.parse("2026-10-12T00:00:00Z");
const FUTURE = "2026-10-13T00:00:00Z";
const PAST = "2026-10-11T00:00:00Z";
const ARN = "arn:aws:codewhisperer:us-east-1:123456789012:profile/test-account";
const kiroQuota = {
  nextDateReset: 1793491200,
  subscriptionInfo: { subscriptionTitle: "KIRO PRO" },
  usageBreakdownList: [{ resourceType: "CREDIT", displayNamePlural: "Credits",
    currentUsage: 26, currentUsageWithPrecision: 26.63, usageLimit: 5000, usageLimitWithPrecision: 5000 }],
};
const agyQuota = { groups: [{ displayName: "Gemini Models", buckets: [
  { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.75, resetTime: FUTURE },
  { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.5, resetTime: FUTURE },
] }] };
function available(report: UsageReport) {
  assert.equal(report.status, "available");
  if (report.status !== "available") throw new Error("Expected available quota");
  return report;
}
async function directory(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "paseo-usage-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function kiroStore(root: string, token = "kiro-secret", expiry = FUTURE, key = "kirocli:odic:token") {
  const file = path.join(root, ".local", "share", "kiro-cli", "data.sqlite3");
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS auth_kv (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT OR REPLACE INTO auth_kv VALUES (?, ?)").run(key, JSON.stringify({ access_token: token, expires_at: expiry, refresh_token: "never-redeem-me" }));
    db.prepare("INSERT OR REPLACE INTO state VALUES (?, ?)").run("api.codewhisperer.profile", JSON.stringify({ arn: ARN }));
  } finally { db.close(); }
  return file;
}
async function agyStore(root: string, token = "agy-secret", expiry = FUTURE) {
  const file = path.join(root, ".gemini", "antigravity-cli", "antigravity-oauth-token");
  await mkdir(path.dirname(file), { recursive: true });
  const claims = Buffer.from(JSON.stringify({ sub: "stable-account", email: "test@example.com" })).toString("base64url");
  await writeFile(file, JSON.stringify({ token: { access_token: token, expiry, refresh_token: "never-redeem-me" }, id_token: `header.${claims}.signature` }));
  return file;
}
function fakeFetch(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

test("Kiro preserves precision, reset timestamps and remaining credits", () => {
  const report = available(parseKiroUsage(kiroQuota, NOW));
  assert.equal(report.planLabel, "KIRO PRO");
  assert.equal(report.balances?.[0].used, 26.63);
  assert.equal(report.balances?.[0].remaining, 4973.37);
  assert.equal(report.windows[0].usedPct, 26.63 / 5000 * 100);
  assert.equal(report.windows[0].resetsAt, "2026-11-01T00:00:00.000Z");
  assert.equal(report.windows[0].label, "Credits");
});

test("Kiro keeps active trials and bonuses separate and excludes expired pools", () => {
  const report = available(parseKiroUsage({ ...kiroQuota, usageBreakdownList: [{ ...kiroQuota.usageBreakdownList[0],
    freeTrialInfo: { freeTrialStatus: "ACTIVE", freeTrialExpiry: FUTURE, currentUsage: 1, usageLimit: 100 },
    bonuses: [
      { bonusCode: "active", status: "ACTIVE", expiresAt: FUTURE, currentUsage: 2, usageLimit: 20 },
      { bonusCode: "expired", status: "ACTIVE", expiresAt: PAST, currentUsage: 0, usageLimit: 20 },
      { bonusCode: "inactive", status: "EXPIRED", expiresAt: FUTURE, currentUsage: 0, usageLimit: 20 },
    ], overageCharges: 2.5,
  }] }, NOW));
  assert.deepEqual(report.windows.map((w) => w.id), ["credit:current", "credit:trial", "credit:bonus:active"]);
  assert.equal(report.balances?.at(-1)?.unit, "usd");
  assert.equal(report.balances?.at(-1)?.used, 2.5);
});

test("Kiro preserves unknown and zero limits without NaN, and does not clamp overuse", () => {
  for (const limit of [0, null]) {
    const report = available(parseKiroUsage({ usageBreakdownList: [{ resourceType: "CREDIT", currentUsage: 1, usageLimit: limit }] }));
    assert.equal(report.windows[0].usedPct, null);
  }
  const report = available(parseKiroUsage({ usageBreakdownList: [{ resourceType: "CREDIT", currentUsage: 120, usageLimit: 100 }] }));
  assert.equal(report.windows[0].usedPct, 120);
  assert.equal(report.windows[0].remainingPct, 0);
  assert.equal(parseKiroUsage({ usageBreakdownList: [] }).status, "unavailable");
  assert.throws(() => parseKiroUsage({ usageBreakdownList: [{ resourceType: "CREDIT", currentUsage: "bad" }] }));
});

test("Antigravity reports named shared periods and keeps IDs stable on reorder/rename", () => {
  const first = available(parseAntigravitySummary(agyQuota));
  const second = available(parseAntigravitySummary({ groups: [{ displayName: "Renamed group", buckets: [...agyQuota.groups[0].buckets].reverse() }] }));
  assert.deepEqual(first.windows.map((w) => w.id), second.windows.map((w) => w.id));
  assert.deepEqual(first.windows.map((w) => w.usedPct), [50, 25]);
  assert.equal(first.windows[0].id, "gemini-5h:five_hour");
  assert.equal(first.windows[1].id, "gemini-weekly:weekly");
});

test("Antigravity respects protobuf zero defaults and rejects invalid fractions", () => {
  const report = available(parseAntigravitySummary({ groups: [{ buckets: [{ bucketId: "empty", window: "5h" }] }] }));
  assert.equal(report.windows[0].usedPct, 100);
  for (const remainingFraction of [-1, 2, "0.5", null]) {
    assert.throws(() => parseAntigravitySummary({ groups: [{ buckets: [{ bucketId: "bad", remainingFraction }] }] }));
  }
});

test("legacy model quotas do not infer a period or merge models with equal usage", () => {
  const report = available(parseAntigravityModels({ models: {
    a: { displayName: "Model A", quotaInfo: { remainingFraction: 0.2, resetTime: FUTURE } },
    b: { displayName: "Model B", quotaInfo: { remainingFraction: 0.2, resetTime: FUTURE } },
    c: { displayName: "No quota" },
  } }));
  assert.equal(report.windows.length, 2);
  assert.ok(report.windows.every((w) => w.label.endsWith("Rolling")));
  assert.deepEqual(report.windows.map((w) => w.id), ["model:a:rolling", "model:b:rolling"]);
});

test("discovery isolates session HOME from daemon HOME and does not leak tokens", async (t) => {
  const root = await directory(t);
  await kiroStore(root);
  await agyStore(root);
  for (const [source, provider] of [
    [createKiroUsageSource({ env: { HOME: root } }), "kiro"],
    [createAntigravityUsageSource({ env: { HOME: root } }), "antigravity"],
  ] as const) {
    const accounts = await source.discover({ kind: "global" });
    assert.equal(accounts.length, 1);
    assert.match(accounts[0].key, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(accounts).includes("secret"), false);
    assert.deepEqual(await source.discover({ kind: "session", provider: "unrelated", env: { HOME: root } }), []);
    assert.deepEqual(await source.discover({ kind: "session", provider, env: { HOME: path.join(root, "other") } }), []);
    assert.deepEqual(await source.discover({ kind: "session", provider, env: { HOME: root } }), accounts);
  }
});

test("session discovery excludes non-OAuth Antigravity and Kiro API-key sessions", async (t) => {
  const root = await directory(t);
  await agyStore(root);
  await kiroStore(root);
  for (const key of ["GEMINI_API_KEY", "AGY_ADC_AUTH", "AGY_LLM_GATEWAY_URL", "ANTIGRAVITY_LS_ADDRESS"]) {
    assert.deepEqual(await createAntigravityUsageSource().discover({ kind: "session", provider: "antigravity", env: { HOME: root, [key]: "configured" } }), []);
  }
  assert.deepEqual(await createKiroUsageSource().discover({ kind: "session", provider: "kiro", env: { HOME: root, KIRO_API_KEY: "configured" } }), []);
});

test("credential paths support XDG and explicit store overrides", async (t) => {
  const root = await directory(t);
  const kiro = await kiroStore(root, "social-secret", FUTURE, "kirocli:social:token");
  const agy = await agyStore(root);
  for (const env of [{ XDG_DATA_HOME: path.join(root, ".local", "share") }, { KIRO_USAGE_DB: kiro }]) {
    assert.equal((await createKiroUsageSource({ env }).discover({ kind: "global" })).length, 1);
  }
  assert.equal((await createAntigravityUsageSource({ env: { AGY_USAGE_TOKEN_FILE: agy } }).discover({ kind: "global" })).length, 1);
});

test("fetch re-reads rotated credentials, uses provider endpoints, and leaves files unchanged", async (t) => {
  const root = await directory(t);
  const files = [await kiroStore(root), await agyStore(root)];
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher: Fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(String(url).includes("amazonaws") ? kiroQuota : agyQuota));
  };
  const sources = [createKiroUsageSource({ env: { HOME: root }, fetch: fetcher, now: () => NOW }),
    createAntigravityUsageSource({ env: { HOME: root }, fetch: fetcher, now: () => NOW })];
  const accounts = await Promise.all(sources.map((s) => s.discover({ kind: "global" })));
  await kiroStore(root, "rotated-kiro");
  await agyStore(root, "rotated-agy");
  const before = await Promise.all(files.map((f) => readFile(f)));
  for (const [i, source] of sources.entries()) {
    available(await source.fetch(accounts[i][0].input));
    assert.deepEqual(await readFile(files[i]), before[i]);
    assert.equal((await source.discover({ kind: "global" }))[0].key, accounts[i][0].key);
  }
  assert.equal(new Headers(calls[0].options?.headers).get("Authorization"), "Bearer rotated-kiro");
  assert.equal(new URL(calls[0].url).searchParams.get("profileArn"), ARN);
  assert.equal(new URL(calls[0].url).hostname, "codewhisperer.us-east-1.amazonaws.com");
  assert.equal(new Headers(calls[1].options?.headers).get("Authorization"), "Bearer rotated-agy");
  assert.match(new Headers(calls[1].options?.headers).get("User-Agent")!, /^antigravity\//);
  assert.equal(calls[1].url, "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
  assert.equal(calls[1].options?.redirect, "error");
});

test("expired logins remain discoverable but fetch never refreshes or requests quota", async (t) => {
  const root = await directory(t);
  await kiroStore(root, "kiro-secret", PAST);
  await agyStore(root, "agy-secret", PAST);
  const fetcher: Fetcher = async () => { assert.fail("Must not fetch for expired credentials"); };
  for (const [source, cli] of [
    [createKiroUsageSource({ env: { HOME: root }, fetch: fetcher, now: () => NOW }), "kiro-cli"],
    [createAntigravityUsageSource({ env: { HOME: root }, fetch: fetcher, now: () => NOW }), "agy"],
  ] as const) {
    const accounts = await source.discover({ kind: "global" });
    assert.equal(accounts.length, 1);
    assert.deepEqual(await source.fetch(accounts[0].input), { status: "unavailable", problem: { kind: "expired", expiresAt: "2026-10-11T00:00:00.000Z", refreshedBy: cli } });
  }
});

test("auth failures and rate limits stay isolated and never include upstream bodies", async (t) => {
  const root = await directory(t);
  const paths = [await kiroStore(root), await agyStore(root)];
  for (const status of [401, 403, 429, 500]) {
    for (const [i, factory] of [createKiroUsageSource, createAntigravityUsageSource].entries()) {
      const source = factory({ fetch: fakeFetch({ error: "SENSITIVE-RESPONSE" }, status), now: () => NOW });
      const report = await source.fetch({ path: paths[i] });
      assert.equal(report.status, status < 429 ? "unavailable" : "error");
      assert.ok(!JSON.stringify(report).includes("SENSITIVE"));
    }
  }
});

test("Antigravity falls back only for unsupported or empty summaries", async (t) => {
  const root = await directory(t);
  const file = await agyStore(root);
  for (const status of [200, 404, 501]) {
    let calls = 0;
    const fetcher: Fetcher = async () => ++calls === 1
      ? new Response("{}", { status })
      : new Response(JSON.stringify({ models: { m: { quotaInfo: { remainingFraction: 0.25 } } } }));
    const report = available(await createAntigravityUsageSource({ fetch: fetcher, now: () => NOW }).fetch({ path: file }));
    assert.equal(calls, 2);
    assert.equal(report.windows[0].usedPct, 75);
  }
  let calls = 0;
  const fetcher: Fetcher = async () => { calls++; return new Response("{}", { status: 403 }); };
  assert.equal((await createAntigravityUsageSource({ fetch: fetcher, now: () => NOW }).fetch({ path: file })).status, "unavailable");
  assert.equal(calls, 1);
});

test("corrupt and removed stores produce safe errors and input schemas reject credentials", async (t) => {
  const root = await directory(t);
  const file = await agyStore(root);
  const source = createAntigravityUsageSource({ env: { HOME: root }, now: () => NOW });
  const [account] = await source.discover({ kind: "global" });
  await writeFile(file, '{"access_token":"SENSITIVE-SECRET');
  assert.equal((await source.fetch(account.input)).status, "error");
  assert.ok(!JSON.stringify(await source.fetch(account.input)).includes("SENSITIVE"));
  await assert.rejects(() => source.discover({ kind: "global" }), /Could not read/);
  await rm(file);
  assert.equal((await source.fetch(account.input)).status, "error");
  assert.deepEqual(await source.discover({ kind: "global" }), []);
  assert.equal(source.input.safeParse({ path: file, token: "secret" }).success, false);
});

test("network, timeout and malformed responses return safe errors", async (t) => {
  const root = await directory(t);
  const file = await agyStore(root);
  for (const fetcher of [
    (async () => { throw new Error("SENSITIVE-SECRET"); }) as Fetcher,
    (async () => new Response("not JSON SENSITIVE-SECRET")) as Fetcher,
    fakeFetch({ groups: "invalid SENSITIVE-SECRET" }),
  ]) {
    const report = await createAntigravityUsageSource({ fetch: fetcher, now: () => NOW }).fetch({ path: file });
    assert.equal(report.status, "error");
    assert.ok(!JSON.stringify(report).includes("SENSITIVE"));
  }
  await assert.rejects(() => requestJson(async () => { throw new Error("aborted"); },
    "https://example.invalid", "test-token", AbortSignal.abort()), /Quota request timed out/);
});
