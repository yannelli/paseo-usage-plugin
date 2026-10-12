import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { verifyConditions } from "./release-manifests.mjs";

const registry = "https://registry.npmjs.org";

export function parsePackResult(output, pkg) {
  const result = JSON.parse(output);
  // npm 12 keys results by package name; earlier versions return an array.
  const packed = Array.isArray(result) ? result[0] : result?.[pkg.name];
  if (packed?.name !== pkg.name || packed.version !== pkg.version ||
      !/^yannelli-paseo-usage-plugin-\d+\.\d+\.\d+\.tgz$/.test(packed.filename) || !packed.integrity) {
    throw new Error("Unexpected npm pack output");
  }
  return packed;
}

export async function alreadyPublished(pkg, request = fetch) {
  const url = `${registry}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response = await request(url, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm version lookup failed: HTTP ${response.status}`);
  const published = await response.json();
  if (published.name !== pkg.name || published.version !== pkg.version) {
    throw new Error("npm returned unexpected package metadata");
  }
  if (published.dist?.integrity !== pkg.integrity) {
    throw new Error("The published version has different contents; create a new release");
  }
  return true;
}

export async function publishNpm() {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const version = await verifyConditions({}, { cwd: process.cwd() });
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.name !== "@yannelli/paseo-usage-plugin" || pkg.publishConfig?.registry !== registry) {
    throw new Error("Unexpected npm package identity or registry");
  }
  if (git("status", "--porcelain")) throw new Error("npm publication requires a clean checkout");
  if (git("rev-parse", "HEAD") !== git("rev-parse", `v${version}^{commit}`)) {
    throw new Error("npm publication requires the exact release tag");
  }
  const packed = parsePackResult(execFileSync("npm", ["pack", "--json"], { encoding: "utf8" }), pkg);
  if (await alreadyPublished(packed)) {
    console.log(`${pkg.name}@${version} already exists with matching contents`);
  } else {
    execFileSync("npm", ["publish", packed.filename, "--access", "public", "--provenance", "--registry", registry], { stdio: "inherit" });
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nfilename=${packed.filename}\n`);
  }
  return packed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await publishNpm();
