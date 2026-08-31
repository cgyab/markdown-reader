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

// Pass the built files individually rather than the directory holding them.
// Node 18 and 20 search a directory argument for tests; Node 22 changed that to
// treat the argument as a file to load, which fails with MODULE_NOT_FOUND. An
// explicit list behaves the same on every version.
const built = readdirSync(OUT_DIR)
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => join(OUT_DIR, file))
  .sort();

if (built.length !== entryPoints.length) {
  console.error(`Expected ${entryPoints.length} bundled test files, found ${built.length}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
process.exit(result.status ?? 1);
