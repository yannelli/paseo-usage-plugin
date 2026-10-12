import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { z } from "zod";
import { unavailable, type UsageReport, type UsageScope } from "@getpaseo/plugin/server/usage";

export const storeInput = z.object({ path: z.string().min(1) }).strict();
export type Environment = Record<string, string | undefined>;
export type Fetcher = typeof fetch;
export const PLUGIN_USER_AGENT = "paseo-usage-plugin";

export function environment(scope: UsageScope, globalEnv: Environment): Environment {
  return scope.kind === "session" ? scope.env : globalEnv;
}

export function home(env: Environment): string {
  return env.HOME || env.USERPROFILE || homedir();
}

export function missingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    // JSON parser errors can include fragments of credential files.
    throw new Error("The CLI credential store contains invalid JSON.");
  }
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}

export function expired(expiresAt: string | null, cli: string, now: number): UsageReport | null {
  return expiresAt && Date.parse(expiresAt) <= now
    ? unavailable({ kind: "expired", expiresAt, refreshedBy: cli })
    : null;
}

export class QuotaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Quota request failed (HTTP ${status}).`);
  }
}

export async function requestJson(
  fetcher: Fetcher, url: URL | string, token: string, signal: AbortSignal, body?: object,
  userAgent = PLUGIN_USER_AGENT,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": userAgent },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
      redirect: "error",
    });
  } catch {
    throw new Error(signal.aborted ? "Quota request timed out." : "Could not reach the quota service.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new QuotaHttpError(response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("The quota service returned invalid JSON.");
  }
}

export function failure(error: unknown, cli: string): UsageReport {
  if (error instanceof QuotaHttpError && (error.status === 401 || error.status === 403)) {
    return unavailable({ kind: "rejected", status: error.status, refreshedBy: cli });
  }
  // Only expose messages we control, never Zod values, request bodies or upstream error text.
  const message = error instanceof QuotaHttpError ? error.message
    : error instanceof Error && /^(Quota request timed out\.|Could not reach the quota service\.|The quota service returned invalid JSON\.|The CLI credential store contains invalid JSON\.)$/.test(error.message)
      ? error.message : "Could not read CLI credentials or quota data. Check the CLI login and credential store.";
  return { status: "error", error: message };
}

export function jwtIdentity(token: string | undefined): { sub?: string; email?: string } {
  if (!token) return {};
  try {
    // Unverified claims are used only for display/grouping, never authorization.
    return z.object({ sub: z.string().optional(), email: z.string().optional() })
      .parse(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()));
  } catch {
    return {};
  }
}
