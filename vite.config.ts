import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "esbuild";
import { defineConfig, type Plugin } from "vite";

const SW_SOURCE = "src/pwa/sw.ts";
const ICON_DIR = "public/icons";

/**
 * Content hash of the icon set, appended to every icon URL as `?v=…`.
 *
 * Icon filenames are fixed — Android, the manifest and the page all point at
 * `icon-192.png` — so without this there is no way to retire a cached copy:
 * the browser holds its cached bytes, and Chrome never notices the art changed
 * because the manifest still lists the same URL, so an installed WebAPK keeps
 * the old icon indefinitely. Versioning the URL changes the manifest, which is
 * what makes Chrome fetch a rebuilt WebAPK.
 */
function iconVersion(): string {
  const hash = createHash("sha256");
  for (const file of listFiles(ICON_DIR).sort()) hash.update(readFileSync(file));
  return hash.digest("hex").slice(0, 8);
}

/** Adds `?v=…` to an icon path, leaving anything else alone. */
function versioned(path: string, version: string): string {
  return /^\.?\/?icons\//.test(path) ? `${path}?v=${version}` : path;
}

/**
 * Content-Security-Policy for the built application.
 *
 * The reader loads no third-party code and calls no API; the only remote thing
 * a document can pull is an image. It is injected into the built index.html as
 * a meta tag so the policy travels with the files, and sent again as a header
 * by public/.htaccess — where it can also carry `frame-ancestors`, which a meta
 * tag is not allowed to set. A test keeps the two in step.
 *
 * It is deliberately *not* applied in development: Vite injects styles inline
 * while serving, which `style-src 'self'` would block.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: "markdown-reader-csp",
    apply: "build",
    transformIndexHtml(html) {
      const version = iconVersion();
      return (
        html
          // Placed by hand rather than through the tag API so that it lands
          // directly after the charset declaration and keeps its quoting intact.
          .replace(
            '<meta charset="utf-8" />',
            `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
          )
          .replace(/(\.\/icons\/[\w.-]+)"/g, `$1?v=${version}"`)
      );
    },
  };
}

/**
 * Builds the service worker.
 *
 * The worker is written in TypeScript alongside the rest of the code, but it
 * cannot go through the normal module graph: it must land at the site root as
 * a standalone classic script, and it needs the list of shell files that only
 * exists once the build has finished. esbuild (already present as part of
 * Vite's toolchain) bundles it, and the precache list is injected as a
 * constant. The cache name is a hash of that list, so an unchanged build
 * produces an unchanged worker.
 */
function serviceWorkerPlugin(): Plugin {
  const bundle = async (precache: string[], version: string): Promise<string> => {
    const result = await build({
      entryPoints: [SW_SOURCE],
      bundle: true,
      format: "iife",
      target: "es2020",
      write: false,
      define: {
        __PRECACHE__: JSON.stringify(precache),
        __VERSION__: JSON.stringify(version),
      },
    });
    return result.outputFiles[0].text;
  };

  return {
    name: "markdown-reader-service-worker",

    // In development the worker is served with an empty precache list: there
    // is nothing stable to cache, but the share-target endpoint still works.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || request.url.split("?")[0] !== "/sw.js") return next();
        bundle([], "dev").then(
          (code) => {
            response.setHeader("content-type", "text/javascript");
            response.setHeader("cache-control", "no-store");
            response.end(code);
          },
          (error) => next(error),
        );
      });
    },

    async closeBundle() {
      const outDir = "dist";
      const files = listFiles(outDir)
        .map((file) => relative(outDir, file).split("\\").join("/"))
        .filter((file) => file !== "sw.js")
        // Dotfiles are server configuration, not application assets. Apache
        // answers 403 for .htaccess, and one unfetchable entry in `addAll`
        // fails the whole install — leaving the site with no worker at all.
        .filter((file) => !file.split("/").some((part) => part.startsWith(".")))
        .sort();

      const icons = iconVersion();

      // The built manifest points at versioned icon URLs; the source manifest
      // stays clean, so the version never has to be maintained by hand.
      const manifestPath = join(outDir, "manifest.webmanifest");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        icons?: Array<{ src: string }>;
      };
      for (const icon of manifest.icons ?? []) icon.src = versioned(icon.src, icons);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      // Hash the contents, not the file sizes: an edit that happens to keep a
      // file the same length must still produce a new cache.
      const version = createHash("sha256")
        .update(
          files.map((file) => `${file}:${readFileSync(join(outDir, file)).toString("base64")}`).join("\n"),
        )
        .digest("hex")
        .slice(0, 12);

      const precache = files.map((file) => versioned(file, icons));
      writeFileSync(join(outDir, "sw.js"), await bundle(precache, version));
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export default defineConfig({
  // Relative base: the application works at a domain root or any subpath.
  base: "./",
  plugins: [contentSecurityPolicyPlugin(), serviceWorkerPlugin()],
  build: {
    target: "es2020",
    modulePreload: { polyfill: false },
  },
});
