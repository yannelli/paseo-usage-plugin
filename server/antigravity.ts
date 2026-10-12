import path from "node:path";
import { z } from "zod";
import {
  hashAccountKey, toneFromUsedPct, unavailable, windowFromReportedDuration,
  type UsageReport, type UsageSourceRegistration, type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import {
  environment, expired, failure, home, isoDate, jwtIdentity, missingFile, QuotaHttpError,
  readJson, requestJson, storeInput, PLUGIN_USER_AGENT, type Environment, type Fetcher,
} from "./common";

const loginSchema = z.object({
  token: z.object({ access_token: z.string().min(1), expiry: z.string().optional() }),
  id_token: z.string().optional(),
});
// Cloud Code requires an Antigravity client identifier even for read-only quota calls.
const USER_AGENT = `antigravity/1.3.3 ${PLUGIN_USER_AGENT}`;
// These endpoints use protobuf JSON: an omitted numeric scalar means zero.
const fraction = z.number().finite().min(0).max(1).default(0);
const summarySchema = z.object({ groups: z.array(z.object({
  displayName: z.string().optional(),
  buckets: z.array(z.object({
    bucketId: z.string().min(1), displayName: z.string().optional(), window: z.string().optional(),
    remainingFraction: fraction, resetTime: z.string().optional(),
  })).default([]),
})).default([]) });
const modelsSchema = z.object({ models: z.record(z.string(), z.object({
  displayName: z.string().optional(),
  quotaInfo: z.object({ remainingFraction: fraction, resetTime: z.string().optional() }).optional(),
})) });

export async function readAntigravityLogin(file: string) {
  const login = loginSchema.parse(await readJson(file));
  return { token: login.token.access_token, expiresAt: isoDate(login.token.expiry), ...jwtIdentity(login.id_token) };
}

function duration(window: string | undefined): number | null {
  if (window === "weekly") return 604800;
  if (window === "daily") return 86400;
  const match = window?.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/);
  return match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 1) : null;
}

export function parseAntigravitySummary(value: unknown): UsageReport {
  const data = summarySchema.parse(value);
  const windows: UsageWindow[] = [];
  for (const group of data.groups) {
    for (const bucket of group.buckets) {
      const pct = (1 - bucket.remainingFraction) * 100;
      windows.push(windowFromReportedDuration({
        durationSeconds: duration(bucket.window),
        scope: { id: bucket.bucketId, label: group.displayName ?? bucket.displayName ?? bucket.bucketId },
        unknown: { id: bucket.window ?? "rolling", label: bucket.window ?? "Rolling", shortLabel: bucket.window ?? "" },
        utilizationPct: pct, resetsAt: isoDate(bucket.resetTime), summary: true, tone: toneFromUsedPct(pct),
      }));
    }
  }
  return windows.length ? { status: "available", windows: windows.sort((a, b) => a.id.localeCompare(b.id)) }
    : unavailable({ kind: "no_quota", detail: "Antigravity did not report any account quota buckets." });
}

export function parseAntigravityModels(value: unknown): UsageReport {
  const data = modelsSchema.parse(value);
  const windows = Object.entries(data.models).flatMap(([id, model]) => {
    if (!model.quotaInfo) return [];
    const pct = (1 - model.quotaInfo.remainingFraction) * 100;
    // Older responses provide only a reset instant, not a period or shared bucket ID.
    // Keep each model independent; equal numbers are not evidence of a shared quota.
    return [windowFromReportedDuration({ durationSeconds: null,
      scope: { id: `model:${id}`, label: model.displayName ?? id },
      unknown: { id: "rolling", label: "Rolling", shortLabel: "" },
      utilizationPct: pct, resetsAt: isoDate(model.quotaInfo.resetTime), summary: true, tone: toneFromUsedPct(pct),
    })];
  });
  return windows.length ? { status: "available", windows: windows.sort((a, b) => a.id.localeCompare(b.id)) }
    : unavailable({ kind: "no_quota", detail: "Antigravity did not report model quota information." });
}

export function createAntigravityUsageSource(options: { env?: Environment; fetch?: Fetcher; now?: () => number } = {}): UsageSourceRegistration {
  const globalEnv = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    id: "antigravity", label: "Antigravity", input: storeInput,
    async discover(scope) {
      if (scope.kind === "session" && !["antigravity", "agy"].includes(scope.provider)) return [];
      const env = environment(scope, globalEnv);
      // API-key, ADC, gateway and remote language-server sessions have a different login.
      if (scope.kind === "session" && ["GEMINI_API_KEY", "GOOGLE_API_KEY", "AGY_ADC_AUTH", "AGY_LLM_GATEWAY_URL", "ANTIGRAVITY_LS_ADDRESS", "CLOUD_CODE_URL"].some((key) => env[key])) return [];
      const file = path.resolve(env.AGY_USAGE_TOKEN_FILE || path.join(home(env), ".gemini", "antigravity-cli", "antigravity-oauth-token"));
      try {
        const login = await readAntigravityLogin(file);
        return [{ key: hashAccountKey(login.sub ?? file), label: login.email ?? "Antigravity", harness: "Antigravity CLI", input: { path: file } }];
      } catch (error) {
        if (missingFile(error)) return [];
        throw new Error("Could not read the Antigravity CLI login store.");
      }
    },
    async fetch(input) {
      try {
        const login = await readAntigravityLogin(storeInput.parse(input).path);
        const problem = expired(login.expiresAt, "agy", now());
        if (problem) return problem;
        const signal = AbortSignal.timeout(15_000);
        try {
          const report = parseAntigravitySummary(await requestJson(fetcher,
            "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary", login.token, signal, {}, USER_AGENT));
          if (report.status === "available") return report;
        } catch (error) {
          if (!(error instanceof QuotaHttpError && [404, 501].includes(error.status))) throw error;
        }
        return parseAntigravityModels(await requestJson(fetcher,
          "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", login.token, signal, {}, USER_AGENT));
      } catch (error) { return failure(error, "agy"); }
    },
  };
}
