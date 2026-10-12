import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { alreadyPublished, parsePackResult } from "../scripts/publish-npm.mjs";

const pkg = { name: "@yannelli/paseo-usage-plugin", version: "0.2.0", integrity: "sha512-example" };
const metadata = { name: pkg.name, version: pkg.version, dist: { integrity: pkg.integrity } };

test("publisher understands actual npm pack output and includes the installable plugin", async () => {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd, encoding: "utf8" });
  const packed = parsePackResult(output, manifest);
  const files = packed.files.map(({ path }) => path);
  for (const path of ["paseo-plugin.json", "index.server.ts", "server/kiro.ts", "server/antigravity.ts", "assets/icon.png"]) {
    assert.ok(files.includes(path), `Missing plugin file: ${path}`);
  }
  assert.ok(files.every((path) => !/^(?:node_modules|test|scripts|\.github|docs\/graphics)\//.test(path)));
  // Support both npm output formats on Node 22 and Node 24 CI runners.
  assert.deepEqual(parsePackResult(JSON.stringify([packed]), manifest), packed);
  assert.deepEqual(parsePackResult(JSON.stringify({ [manifest.name]: packed }), manifest), packed);
  assert.throws(() => parsePackResult(JSON.stringify({}), manifest), /Unexpected npm pack output/);
  assert.throws(() => parsePackResult(JSON.stringify([{ ...packed, version: "9.9.9" }]), manifest), /Unexpected npm pack output/);
});

test("npm publication skips only the same version with matching package contents", async () => {
  assert.equal(await alreadyPublished(pkg, async (url, options) => {
    assert.equal(url, "https://registry.npmjs.org/%40yannelli%2Fpaseo-usage-plugin/0.2.0");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(metadata);
  }), true);
  assert.equal(await alreadyPublished(pkg, async () => new Response(null, { status: 404 })), false);
  await assert.rejects(alreadyPublished(pkg, async () => Response.json({ ...metadata, dist: { integrity: "sha512-other" } })), /different contents/);
  await assert.rejects(alreadyPublished(pkg, async () => Response.json({ ...metadata, version: "0.1.0" })), /unexpected package metadata/);
});

test("npm lookup errors never authorize publication", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(alreadyPublished(pkg, async () => new Response("upstream error", { status })), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(alreadyPublished(pkg, async () => { throw new Error("network unavailable"); }), /network unavailable/);
  await assert.rejects(alreadyPublished(pkg, async () => new Response("not JSON")), SyntaxError);
  await assert.rejects(alreadyPublished(pkg, async () => Response.json({})), /unexpected package metadata/);
  await assert.rejects(alreadyPublished(pkg, async () => Response.json({ ...metadata, dist: {} })), /different contents/);
});

test("npm publisher rejects uncommitted files and commits after the release tag", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "paseo-npm-publish-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  await writeFile(join(cwd, "package.json"), JSON.stringify({
    name: pkg.name, version: pkg.version, publishConfig: { registry: "https://registry.npmjs.org" },
  }));
  await writeFile(join(cwd, "package-lock.json"), JSON.stringify({
    version: pkg.version, packages: { "": { version: pkg.version } },
  }));
  git("add", ".");
  git("commit", "-m", "Release fixture");
  git("tag", `v${pkg.version}`);
  const script = fileURLToPath(new URL("../scripts/publish-npm.mjs", import.meta.url));
  const publish = () => promisify(execFile)(process.execPath, [script], { cwd });
  await writeFile(join(cwd, "README.md"), "Unreleased documentation");
  await assert.rejects(publish(), /requires a clean checkout/);
  git("add", ".");
  git("commit", "-m", "docs: unreleased change");
  await assert.rejects(publish(), /requires the exact release tag/);
});
