/**
 * End-to-end verification of a production build, in a real browser.
 *
 * `npm test` covers the parser, the renderer and the deployment config, but it
 * cannot exercise a service worker, a share-target POST, offline behaviour or
 * the Content-Security-Policy. This script does, by serving dist/ with exactly
 * the headers .htaccess sets and driving Chrome against it.
 *
 *     npm run build
 *     npm install --no-save puppeteer-core
 *     npm run verify
 *
 * It is deliberately not part of `npm test`: it needs a Chrome binary and a
 * driver that the application itself has no business depending on.
 */

import { createServer } from "node:http";
import { readFile, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const FIXTURE = join(ROOT, "TEST.md");
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}/`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

/** The headers production actually sends, read from the deployed config. */
function productionHeaders() {
  const htaccess = readFileSync(join(ROOT, "public/.htaccess"), "utf8");
  return Object.fromEntries([...htaccess.matchAll(/Header always set (\S+) "([^"]+)"/g)].map(
    (match) => [match[1], match[2]],
  ));
}

function serve(headers) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, BASE).pathname);
    const file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    const target = path.endsWith("/") ? join(file, "index.html") : file;

    // Apache denies .ht* by default. Mimicking that here is the point: a
    // precache list containing .htaccess installs fine against a permissive
    // static server and fails on the real one.
    if (target.split("/").pop().startsWith(".ht")) {
      response.writeHead(403).end("forbidden");
      return;
    }

    readFile(target, (error, body) => {
      if (error) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, {
        ...headers,
        "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      });
      response.end(body);
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

const results = [];
const check = (name, pass, detail = "") =>
  results.push({ name, pass, detail: detail ? String(detail) : "" });

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.error("puppeteer-core is not installed. Run:\n  npm install --no-save puppeteer-core");
  process.exit(2);
}

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const server = await serve(productionHeaders());
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  const problems = [];
  page.on("console", (message) => {
    if (/refused to|content security policy/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));

  // ---------------------------------------------------------------- shell
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, state: registration.active?.state ?? null };
  });
  check("service worker activates", worker.state === "activated", worker.scope);
  check("empty state is shown", await page.$eval("#empty-state", (el) => !el.hidden));
  check("print is disabled with no document", await page.$eval("#print-button", (b) => b.disabled));

  // ------------------------------------------------------------ open a file
  // Headless Chrome implements showOpenFilePicker, whose native dialog cannot
  // be driven from here. Removing it exercises the <input type=file> fallback,
  // which is the path Android Chrome takes anyway.
  await page.evaluate(() => {
    delete window.showOpenFilePicker;
  });
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 10_000 }),
    page.click("#open-button"),
  ]);
  check("picker takes a single file", chooser.isMultiple() === false);
  await chooser.accept([FIXTURE]);
  await page.waitForSelector("#document-view article h1", { timeout: 15_000 });

  const rendered = await page.evaluate(() => {
    const view = document.getElementById("document-view");
    return {
      headings: view.querySelectorAll("h1,h2,h3").length,
      tables: view.querySelectorAll("table").length,
      code: view.querySelectorAll("pre code").length,
      checkboxes: view.querySelectorAll('input[type="checkbox"]').length,
      active: view.querySelectorAll("script,iframe,object,embed,svg,form").length,
      handlers: [...view.querySelectorAll("*")].filter((el) =>
        [...el.attributes].some((attribute) => attribute.name.startsWith("on")),
      ).length,
      badUrls: [...view.querySelectorAll("a,img")].filter((el) =>
        /^\s*(javascript|vbscript|file|blob):/i.test(
          el.getAttribute("href") ?? el.getAttribute("src") ?? "",
        ),
      ).length,
      opener: [...view.querySelectorAll('a[target="_blank"]')].every((a) =>
        (a.rel || "").includes("noopener"),
      ),
      filename: document.getElementById("filename").textContent,
    };
  });
  check("TEST.md renders", rendered.headings > 50, `${rendered.headings} headings`);
  check("tables render", rendered.tables >= 2, `${rendered.tables} tables`);
  check("code blocks render", rendered.code > 10, `${rendered.code} blocks`);
  check("task lists render", rendered.checkboxes >= 4, `${rendered.checkboxes} checkboxes`);
  check("document produced no active elements", rendered.active === 0);
  check("document produced no event handlers", rendered.handlers === 0);
  check("document produced no dangerous URLs", rendered.badUrls === 0);
  check("external links carry noopener", rendered.opener);
  check("filename is shown", rendered.filename === "TEST.md", rendered.filename);

  // ---------------------------------------------------------------- print
  await page.emulateMediaType("print");
  const printed = await page.evaluate(() => ({
    bar: getComputedStyle(document.querySelector(".app-bar")).display,
    document: getComputedStyle(document.getElementById("document-view")).display,
  }));
  check("print CSS hides the app bar", printed.bar === "none");
  check("print CSS keeps the document", printed.document !== "none");
  await page.emulateMediaType(null);

  // --------------------------------------------------------- share target
  const shared = await page.evaluate(async () => {
    const post = async (name, body, type) => {
      const form = new FormData();
      if (name !== null) form.append("file", new File([body], name, { type }));
      const response = await fetch("share-target", { method: "POST", body: form });
      return new URL(response.url).searchParams.get("shared");
    };
    const parked = async () => {
      const cache = await caches.open("shared-document");
      const entry = await cache.match(new URL("__shared-document", location.href).href);
      return entry?.headers.get("x-document-name") ?? null;
    };

    const out = {};
    out.accepted = await post("notes.md", "# Shared\n\nFrom a **share**.\n", "text/markdown");
    out.name = await parked();
    out.unsupported = await post("photo.png", "x", "image/png");
    out.empty = await post(null, "", "");
    await post("../../etc/passwd.md", "# traversal", "text/markdown");
    out.traversal = await parked();
    await post("notes.md", "# Shared\n\nFrom a **share**.\n", "text/markdown");
    return out;
  });
  check("valid share is accepted", shared.accepted === "ok" && shared.name === "notes.md");
  check("wrong file type is refused", shared.unsupported === "unsupported");
  check("share with no file is refused", shared.empty === "empty");
  check("traversal filename is flattened", shared.traversal === "passwd.md", shared.traversal);

  await page.goto(`${BASE}?shared=ok`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#document-view article h1", { timeout: 15_000 });
  const collected = await page.evaluate(async () => {
    const cache = await caches.open("shared-document");
    return {
      heading: document.querySelector("#document-view h1")?.textContent,
      strong: document.querySelector("#document-view strong")?.textContent,
      filename: document.getElementById("filename").textContent,
      search: location.search,
      leftover:
        (await cache.match(new URL("__shared-document", location.href).href)) !== undefined,
    };
  });
  check("shared document renders", collected.heading === "Shared" && collected.strong === "share");
  check("share flag is removed from the URL", collected.search === "");
  check("parked copy is deleted once read", collected.leftover === false);
  check("shared filename is shown", collected.filename === "notes.md", collected.filename);

  await page.evaluate(async () => {
    const cache = await caches.open("shared-document");
    await cache.put(new URL("__shared-document", location.href).href, new Response("# stale"));
  });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  check(
    "a share left behind is purged on a plain visit",
    await page.evaluate(async () => {
      const cache = await caches.open("shared-document");
      return (await cache.match(new URL("__shared-document", location.href).href)) === undefined;
    }),
  );

  // ------------------------------------------------------------- redeploy
  // The scenario that shipped a stale icon: a worker is already installed when
  // new files land on the server. Anything the server marks no-cache — the
  // page and, critically, the manifest Chrome reads to build the WebAPK — must
  // come back fresh on the very next load, not the one after it.
  const manifestPath = join(DIST, "manifest.webmanifest");
  const original = readFileSync(manifestPath, "utf8");
  try {
    const redeployed = original.replace(/"short_name": "[^"]*"/, '"short_name": "Redeployed"');
    if (redeployed === original) throw new Error("could not alter the manifest for the test");
    writeFileSync(manifestPath, redeployed);

    await page.goto(BASE, { waitUntil: "networkidle0" });
    const served = await page.evaluate(async () => {
      const response = await fetch("manifest.webmanifest", { cache: "no-store" });
      return (await response.json()).short_name;
    });
    check("a redeployed manifest is served fresh", served === "Redeployed", `got ${served}`);
  } finally {
    writeFileSync(manifestPath, original);
  }

  await page.goto(BASE, { waitUntil: "networkidle0" });
  const restored = await page.evaluate(async () =>
    (await (await fetch("manifest.webmanifest", { cache: "no-store" })).json()).short_name);
  check("and reverts with the next deploy", restored === "Markdown", `got ${restored}`);

  // -------------------------------------------------------------- offline
  await page.setOfflineMode(true);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const offline = await page.evaluate(() => ({
    button: document.getElementById("open-button")?.textContent,
    styled: getComputedStyle(document.querySelector(".app-bar")).borderBottomStyle,
  }));
  check("application shell loads offline", offline.button === "Open Markdown");
  check("stylesheet is cached as well", offline.styled === "solid");
  await page.setOfflineMode(false);

  // An install that failed leaves no shell cache, and every navigation quietly
  // falls through to the network — which looks fine until the server is gone.
  const cached = await page.evaluate(async () => {
    const shell = (await caches.keys()).find((name) => name.startsWith("app-shell-"));
    if (!shell) return null;
    const cache = await caches.open(shell);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  check("the shell cache was populated", cached !== null && cached.length >= 5,
    cached === null ? "no app-shell cache exists" : `${cached.length} entries`);
  check("every precached entry is fetchable", cached !== null && !cached.some((p) => p.includes("/.")),
    (cached ?? []).filter((p) => p.includes("/.")).join(", "));

  check("no CSP violations or page errors", problems.length === 0, problems.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  server.close();
}

for (const { name, pass, detail } of results) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
