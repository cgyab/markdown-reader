/**
 * Test runner.
 *
 * Node's built-in test runner cannot load TypeScript on Node 18, so the test
 * files are bundled to ESM with esbuild (already available as part of Vite's
 * toolchain) and handed to `node --test`. No test framework is involved.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const OUT_DIR = ".tests";

const entryPoints = readdirSync("tests")
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => join("tests", file));

if (entryPoints.length === 0) {
  console.error("No test files found in tests/");
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints,
  outdir: OUT_DIR,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outExtension: { ".js": ".mjs" },
});

const result = spawnSync(process.execPath, ["--test", OUT_DIR], { stdio: "inherit" });
process.exit(result.status ?? 1);
