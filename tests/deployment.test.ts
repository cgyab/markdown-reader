/**
 * Deployment configuration tests.
 *
 * The Content-Security-Policy exists twice — as a meta tag injected into the
 * built page, and as a header in public/.htaccess — because a meta tag cannot
 * express `frame-ancestors` and a header does not travel with the files. These
 * tests read both and fail if they drift apart, and check the handful of
 * other server rules the application depends on.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

/**
 * Two of these tests inspect the built output. On a fresh clone there is none
 * yet, and `npm test` should not fail for that — it should say what to run.
 */
const built = existsSync(new URL("dist/sw.js", root));
const needsBuild = built ? undefined : { skip: "run `npm run build` first" };

const htaccess = read("public/.htaccess");
const viteConfig = read("vite.config.ts");
const manifest = JSON.parse(read("public/manifest.webmanifest")) as Record<string, unknown>;

/** Splits a policy string into `directive -> value`. */
function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const [name, ...value] = part.split(/\s+/);
        return [name, value.join(" ")] as [string, string];
      }),
  );
}

function metaPolicy(): Map<string, string> {
  const block = /const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join\("; "\);/.exec(viteConfig);
  assert.ok(block, "the build config no longer defines CONTENT_SECURITY_POLICY");
  const parts = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(parts.length > 5, "the policy looks truncated");
  return directives(parts.join("; "));
}

function headerPolicy(): Map<string, string> {
  const header = /Header always set Content-Security-Policy "([^"]+)"/.exec(htaccess);
  assert.ok(header, ".htaccess no longer sets Content-Security-Policy");
  return directives(header[1]);
}

test("the page and the server send the same policy", () => {
  const meta = metaPolicy();
  const header = headerPolicy();

  for (const [directive, value] of meta) {
    assert.equal(header.get(directive), value, `directive ${directive} differs from .htaccess`);
  }

  // Only these two may be header-only: a meta tag is not allowed to set them.
  for (const directive of header.keys()) {
    if (meta.has(directive)) continue;
    assert.ok(
      ["frame-ancestors", "upgrade-insecure-requests"].includes(directive),
      `header adds ${directive}, which the page does not send`,
    );
  }
});

test("the policy forbids inline and third-party code", () => {
  const policy = metaPolicy();
  for (const directive of ["default-src", "script-src", "style-src", "connect-src"]) {
    const value = policy.get(directive);
    assert.equal(value, "'self'", `${directive} should be 'self'`);
  }
  assert.equal(policy.get("object-src"), "'none'");
  assert.equal(policy.get("base-uri"), "'none'");
  assert.equal(headerPolicy().get("frame-ancestors"), "'none'");
});

test("the server sends the rest of the security headers", () => {
  for (const header of [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]) {
    assert.match(htaccess, new RegExp(`Header always set ${header}`), `missing ${header}`);
  }
  assert.match(htaccess, /Options -Indexes/);
});

test("only content-hashed filenames are cached hard", () => {
  const longLived = /Header set Cache-Control "public, max-age=31536000, immutable"/;
  assert.match(htaccess, longLived);

  // The immutable rule must apply only to filenames carrying a content hash.
  const scope = /<FilesMatch "([^"]+)">\s*\n\s*Header set Cache-Control "public, max-age=31536000/
    .exec(htaccess);
  assert.ok(scope, "the immutable rule is no longer scoped by FilesMatch");
  assert.ok(scope[1].includes("[A-Za-z0-9_-]{8,}"), `immutable rule applies to ${scope[1]}`);

  const iconRule = /<FilesMatch "\\\.\(png\|svg[^"]*">\s*\n\s*(?:#[^\n]*\n\s*)*Header set Cache-Control "([^"]+)"/
    .exec(htaccess);
  assert.ok(iconRule, "the icon caching rule is gone");
  assert.ok(!/immutable/.test(iconRule[1]), `icons must not be immutable: ${iconRule[1]}`);
});

test("entry points are not cached, hashed assets are", () => {
  assert.match(htaccess, /<Files "sw\.js">[\s\S]*?no-cache/, "a stale service worker would stick");
  assert.match(htaccess, /\(html\|webmanifest\)\$">\s*\n\s*Header set Cache-Control "no-cache/);
  assert.match(htaccess, /max-age=31536000, immutable/);
});

test("the share-target fallback redirects to an absolute path", () => {
  const rule = /RewriteRule \^share-target\S*\s+(\S+)/.exec(htaccess);
  assert.ok(rule, "the share-target fallback rule is gone");
  // mod_rewrite expands a relative substitution against the filesystem path in
  // a per-directory context, which both breaks the redirect and discloses the
  // server's directory layout.
  assert.ok(rule[1].startsWith("/"), `substitution must be absolute, got ${rule[1]}`);
});

test("the manifest declares an installable share target", () => {
  // Root-absolute: this build is deployed at a domain root, and an absolute
  // action leaves nothing for a manifest parser to resolve differently.
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");

  const share = manifest.share_target as {
    action: string;
    method: string;
    enctype: string;
    params: { files: Array<{ name: string; accept: string[] }> };
  };
  assert.equal(share.method, "POST");
  assert.equal(share.enctype, "multipart/form-data");
  assert.equal(share.action, "/share-target");
  assert.equal(share.params.files[0].name, "file");

  // Android builds the share-sheet intent filter from MIME types alone, and
  // `.md` has no registered type — a file manager sends text/plain or
  // application/octet-stream. Accepting only Markdown types means the app
  // never appears in the share sheet. The extension is checked when the share
  // arrives instead; see the service worker.
  const accept = share.params.files[0].accept;
  for (const type of ["text/*", "application/octet-stream", ".md", ".markdown"]) {
    assert.ok(accept.includes(type), `share target should accept ${type}`);
  }

  // No text/title params: the reader has nothing to do with a text-only share,
  // and declaring them would offer the app for shares it cannot handle.
  const params = share.params as Record<string, unknown>;
  assert.ok(!("text" in params) && !("title" in params));

  const icons = manifest.icons as Array<{ sizes: string; purpose: string }>;
  assert.ok(icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(icons.some((icon) => icon.sizes === "512x512"));
  assert.ok(icons.some((icon) => icon.purpose === "maskable"));
});

test("the share-target field name matches the manifest", () => {
  const protocol = read("src/pwa/share-protocol.ts");
  const field = /SHARE_FIELD = "([^"]+)"/.exec(protocol);
  assert.ok(field);
  const share = manifest.share_target as { params: { files: Array<{ name: string }> } };
  assert.equal(share.params.files[0].name, field[1]);
});

test("the service worker precaches only files the server will serve", needsBuild, () => {
  const worker = read("dist/sw.js");
  const list = /define_PRECACHE_default = (\[[^\]]*\])/.exec(worker);
  assert.ok(list, "the precache list is missing from the built worker");
  const files = JSON.parse(list[1]) as string[];

  assert.ok(files.length >= 5, `only ${files.length} files precached`);
  for (const versionedFile of files) {
    const file = versionedFile.split("?")[0];
    // A dotfile is server configuration; Apache answers 403 for .htaccess, and
    // one unfetchable entry fails the whole install, leaving no worker at all.
    assert.ok(
      !file.split("/").some((part) => part.startsWith(".")),
      `precache list contains ${file}, which the server will not serve`,
    );
    assert.ok(existsSync(new URL(`dist/${file}`, root)), `precached ${file} does not exist`);
  }
  assert.ok(files.includes("index.html"), "the shell itself must be precached");

  // Icons keep fixed filenames, so every reference to one must be versioned or
  // a replaced icon can be served from cache indefinitely.
  const icons = files.filter((file) => file.startsWith("icons/"));
  assert.ok(icons.length >= 3, "icons should be precached");
  for (const icon of icons) {
    assert.match(icon, /\?v=[0-9a-f]{8}$/, `${icon} is not version-stamped`);
  }
});

test("the built output pulls nothing from a third party", needsBuild, () => {
  const built = ["dist/index.html", "dist/sw.js"].map(read).join("\n");
  const remote = [...built.matchAll(/https?:\/\/[^\s"'`]+/g)].map((match) => match[0]);
  assert.deepEqual(remote, [], `built output references ${remote.join(", ")}`);
});
