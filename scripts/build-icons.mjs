/**
 * Rasterises the icon SVGs into the PNGs the manifest needs.
 *
 * The SVGs in public/icons are the source of truth; the PNGs are build output
 * that happens to be committed, because Android needs them and the project has
 * no image dependency. Chrome does the rasterising — it is already required by
 * `npm run verify`, and adding a rendering library for three files would not
 * be worth it.
 *
 *     npm run icons
 *
 * Set CHROME_PATH if Chrome is somewhere other than /usr/bin/google-chrome.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ICONS = new URL("../public/icons/", import.meta.url);

/** [source SVG, output PNG, pixel size] */
const TARGETS = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["maskable.svg", "maskable-512.png", 512],
];

const work = mkdtempSync(join(tmpdir(), "icons-"));

try {
  for (const [source, output, size] of TARGETS) {
    const svg = readFileSync(new URL(source, ICONS), "utf8");
    const page = join(work, `${output}.html`);
    writeFileSync(
      page,
      `<!doctype html><style>html,body{margin:0;padding:0}` +
        `svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );

    execFileSync(CHROME, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${new URL(output, ICONS).pathname}`,
      `file://${page}`,
    ], { stdio: "ignore" });

    console.log(`${output}  ${size}x${size}  from ${source}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
