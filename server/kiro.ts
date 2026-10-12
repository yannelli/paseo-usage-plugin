import { stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  hashAccountKey, toneFromUsedPct, unavailable, usedPctOf, windowFromUsedPct,
  type UsageBalance, type UsageReport, type UsageSourceRegistration, type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import {
  environment, expired, failure, home, isoDate, missingFile, requestJson, storeInput,
  type Environment, type Fetcher,
} from "./common";

const tokenSchema = z.object({
  access_token: z.string().min(1), expires_at: z.string().optional(),
  profile_arn: z.string().optional(),
});
const profileSchema = z.object({ arn: z.string().optional(), profile_name: z.string().optional() });
const number = z.number().finite().nonnegative().nullish();
const timestamp = z.union([z.number().finite(), z.string()]).nullish();
const poolSchema = z.object({
  currentUsage: number, currentUsageWithPrecision: number,
  usageLimit: number, usageLimitWithPrecision: number,
});
const usageSchema = z.object({
  nextDateReset: timestamp,
  subscriptionInfo: z.object({ subscriptionTitle: z.string().nullish() }).nullish(),
  overageConfiguration: z.object({ overageStatus: z.string().nullish() }).nullish(),
  usageBreakdownList: z.array(poolSchema.extend({
    resourceType: z.string().min(1), displayName: z.string().nullish(), displayNamePlural: z.string().nullish(),
    nextDateReset: timestamp, overageCharges: number,
    freeTrialInfo: poolSchema.extend({ freeTrialStatus: z.string(), freeTrialExpiry: timestamp }).nullish(),
    bonuses: z.array(poolSchema.extend({
      bonusCode: z.string().min(1), displayName: z.string().nullish(),
      status: z.string(), expiresAt: timestamp,
    })).nullish(),
  })),
});

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("Missing Kiro credential data.");
  try { return JSON.parse(value); }
  catch { throw new Error("The CLI credential store contains invalid JSON."); }
}

export async function readKiroLogin(file: string) {
  // stat distinguishes a missing login from a corrupt/locked database and prevents creation.
  await stat(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const query = db.prepare("SELECT value FROM auth_kv WHERE key = ?");
    const stored = query.get("kirocli:social:token") ?? query.get("kirocli:odic:token");
    if (!stored) return null;
    const token = tokenSchema.parse(parseStoredJson(stored.value));
    const row = db.prepare("SELECT value FROM state WHERE key = ?").get("api.codewhisperer.profile");
    const profile = row ? profileSchema.parse(parseStoredJson(row.value)) : {};
    const profileArn = token.profile_arn ?? profile.arn;
    // Authentication region and inference region can differ. The profile ARN identifies
    // the service region; otherwise use the CLI's default CodeWhisperer region.
    const region = profileArn?.match(/^arn:aws:codewhisperer:([a-z]+-[a-z]+-\d+):/)?.[1] ?? "us-east-1";
    return { token: token.access_token, expiresAt: isoDate(token.expires_at), profileArn, region, label: profile.profile_name };
  } finally {
    db.close();
  }
}

export function parseKiroUsage(value: unknown, now = Date.now()): UsageReport {
  const data = usageSchema.parse(value);
  const windows: UsageWindow[] = [];
  const balances: UsageBalance[] = [];
  function addPool(id: string, label: string, pool: z.infer<typeof poolSchema>, resetsAt: string | null, unit: UsageBalance["unit"]) {
    const used = pool.currentUsageWithPrecision ?? pool.currentUsage ?? null;
    const limit = pool.usageLimitWithPrecision ?? pool.usageLimit ?? null;
    if (used === null && limit === null) return;
    const pct = usedPctOf(used, limit);
    windows.push(windowFromUsedPct({ id, label, shortLabel: label, summary: true,
      utilizationPct: pct, resetsAt, tone: toneFromUsedPct(pct) }));
    balances.push({ id, label, used, limit, remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
      unit, resetsAt, tone: toneFromUsedPct(pct) });
  }
  for (const resource of data.usageBreakdownList) {
    const id = resource.resourceType.toLowerCase();
    const label = resource.displayNamePlural ?? resource.displayName ?? resource.resourceType;
    const unit = resource.resourceType === "CREDIT" ? "credits" : "requests";
    // The API provides a reset timestamp but no duration. Do not infer a monthly window.
    addPool(`${id}:current`, label, resource, isoDate(resource.nextDateReset ?? data.nextDateReset), unit);
    const trial = resource.freeTrialInfo;
    const trialExpiry = isoDate(trial?.freeTrialExpiry);
    if (trial?.freeTrialStatus === "ACTIVE" && (!trialExpiry || Date.parse(trialExpiry) > now)) {
      addPool(`${id}:trial`, `${label} (trial)`, trial, trialExpiry, unit);
    }
    for (const bonus of resource.bonuses ?? []) {
      const expiry = isoDate(bonus.expiresAt);
      if (bonus.status === "ACTIVE" && (!expiry || Date.parse(expiry) > now)) {
        addPool(`${id}:bonus:${bonus.bonusCode}`, bonus.displayName ?? `${label} (bonus)`, bonus, expiry, unit);
      }
    }
    if (resource.overageCharges != null && resource.overageCharges > 0) {
      balances.push({ id: `${id}:overage`, label: "Overage charges", used: resource.overageCharges, unit: "usd" });
    }
  }
  if (!windows.length) return unavailable({ kind: "no_quota", detail: "Kiro did not report an account usage limit." });
  return { status: "available", planLabel: data.subscriptionInfo?.subscriptionTitle ?? undefined, windows, balances,
    details: data.overageConfiguration?.overageStatus ? [{ id: "overage", label: "Overages", value: data.overageConfiguration.overageStatus }] : [] };
}

export function createKiroUsageSource(options: { env?: Environment; fetch?: Fetcher; now?: () => number } = {}): UsageSourceRegistration {
  const globalEnv = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    id: "kiro", label: "Kiro CLI", icon: "assets/providers/kiro.svg", input: storeInput,
    async discover(scope) {
      if (scope.kind === "session" && !["kiro", "kiro-cli"].includes(scope.provider)) return [];
      const env = environment(scope, globalEnv);
      if (scope.kind === "session" && (env.KIRO_API_KEY || env.KIRO_KAS_ENDPOINT || env.KIRO_KAS_CONTROL_PLANE_ENDPOINT)) return [];
      const file = path.resolve(env.KIRO_USAGE_DB || path.join(env.XDG_DATA_HOME || path.join(home(env), ".local", "share"), "kiro-cli", "data.sqlite3"));
      try {
        const login = await readKiroLogin(file);
        if (!login) return [];
        return [{ key: hashAccountKey(login.profileArn ?? file), label: login.label ?? "Kiro CLI", harness: "Kiro CLI", input: { path: file } }];
      } catch (error) {
        if (missingFile(error)) return [];
        throw new Error("Could not read the Kiro CLI login store.");
      }
    },
    async fetch(input) {
      try {
        const { path: file } = storeInput.parse(input);
        const login = await readKiroLogin(file);
        if (!login) throw new Error("Kiro login no longer exists.");
        const problem = expired(login.expiresAt, "kiro-cli", now());
        if (problem) return problem;
        const url = new URL(`https://codewhisperer.${login.region}.amazonaws.com/getUsageLimits`);
        url.search = new URLSearchParams({ origin: "AI_EDITOR", resourceType: "AGENTIC_REQUEST", isEmailRequired: "false",
          ...(login.profileArn ? { profileArn: login.profileArn } : {}) }).toString();
        return parseKiroUsage(await requestJson(fetcher, url, login.token, AbortSignal.timeout(15_000)), now());
      } catch (error) { return failure(error, "kiro-cli"); }
    },
  };
}
