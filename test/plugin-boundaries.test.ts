import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

test("server import graph stays within Paseo's server/shared module boundary", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const visited = new Set<string>();
  async function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const imports = ts.preProcessFile(await readFile(file, "utf8")).importedFiles;
    for (const { fileName: specifier } of imports) {
      if (!specifier.startsWith(".")) continue;
      const candidate = path.resolve(path.dirname(file), specifier);
      const relative = path.relative(root, candidate).split(path.sep);
      // Paseo rejects other root files (including package.json) even when tsc accepts them.
      assert.ok(["server", "shared"].includes(relative[0]), `${file} imports forbidden module ${specifier}`);
      const target = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.json`].find(existsSync);
      assert.ok(target, `Unresolved local import: ${specifier}`);
      if (/\.tsx?$/.test(target)) await visit(target);
    }
  }
  await visit(path.join(root, "index.server.ts"));
});
