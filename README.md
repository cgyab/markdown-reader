# Markdown Reader

[![CI](https://github.com/cgyab/markdown-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/cgyab/markdown-reader/actions/workflows/ci.yml)

A small, offline-capable reader for Markdown documents. Open a `.md` or
`.markdown` file, read it, print it. It installs as a PWA and registers itself
as an Android share target, so a Markdown file can be shared to it from a file
manager.

Version 1.0 is a reader, not an editor.

Documents are read in the browser and never leave the device — there is no
backend, no account, no storage of your files.

## Requirements

Node 18 or newer. The toolchain is pinned to Vite 6, which supports Node 18;
Vite 7 requires Node 20.19+.

## Commands

```bash
npm install     # install dependencies
npm run dev     # development server
npm run build   # type-check, then production build into dist/
npm run preview # serve the production build
npm test        # run the test suite
npm run verify  # drive a real browser against dist/ (see Verification)
npm run icons   # re-render the icon PNGs from their SVG sources
```

## Deploying

The application is static. There is no PHP, no database, nothing to configure
server-side — any host that serves files will do.

1. `npm run build`.
2. Upload the **contents** of `dist/` — including the hidden `.htaccess` — to
   the directory the site serves. For example:

   ```bash
   rsync -av --delete dist/ user@host:~/site-root/
   ```

   `rsync` copies dotfiles by default; an SFTP client may need "show hidden
   files" turned on. Without `.htaccess` the app still runs, but without any of
   the security headers.
3. Serve it over **HTTPS**. A service worker, PWA installation and the share
   target all require a secure context; `.htaccess` also redirects http → https.
4. Visit the site in Chrome and confirm the install prompt appears.

`.htaccess` is written for Apache, which is what most shared hosting runs. On
nginx, Caddy or a static-site host, translate it: the headers and cache rules
it sets are listed under [Security](#security) and
[What `.htaccess` does](#what-htaccess-does).

### Root deployment

The manifest uses root-absolute paths (`start_url: "/"`, `scope: "/"`,
`action: "/share-target"`), so this build assumes it is served from a **domain
root** — `https://example.com/`, not `https://example.com/reader/`. Page assets
are still relative (`base: "./"`), and the service worker resolves everything
against its own registration scope, so only three manifest fields and one
`.htaccess` rewrite target are tied to the root. Change those four values to
deploy under a subpath.

Relative URLs in a manifest are resolved against the manifest's own URL and are
valid; absolute ones are used here only because there is no subpath to support
and it leaves a share target's `action` with nothing to resolve differently.

Redeploying is a straight file copy: `index.html`, `manifest.webmanifest` and
`sw.js` are served `no-cache`, and the hashed asset filenames change with their
contents, so a visitor picks up a new build on their next visit rather than
being stuck behind a cached shell.

### What `.htaccess` does

- Forces HTTPS and disables directory listings.
- Sets the MIME type for `.webmanifest` (Apache does not know it) and UTF-8
  charsets.
- Caches hashed assets for a year, and the entry points not at all.
- Sends the security headers listed under [Security](#security) below.
- Answers a share-target POST with a redirect to the reader's own error state
  if the service worker is missing, instead of a 404. That substitution must be
  root-absolute: `.htaccess` is always a per-directory context, and mod_rewrite
  expands a relative substitution there against the **filesystem** path, so
  `./?shared=…` redirects the browser to
  `https://example.com/home/user/example.com/?shared=…` — broken, and a
  disclosure of the server's directory layout.

## Icons

`public/icons/icon.svg` is the source; `maskable.svg` is the same emblem inset
for Android's safe zone, and the three PNGs are rendered from them by
`npm run icons` (Chrome does the rasterising — no image dependency). Edit the
SVG, re-run, rebuild.

The design follows a small house style shared with a few sibling apps: a
64-unit rounded plate in near-black, a flat emblem floating on it with no
container box, and two accents — one cool, one warm. Here that is a heading
marker and the lines of a document, in blue (`#8fd0ff`) and gold (`#ffd86b`) on
a `#121212` plate, which is also the app's `theme_color`.

### Cache busting

Icon filenames are fixed — the manifest, the page and Android all point at
`icon-192.png` — so a replaced icon has no new URL to be fetched from. Three
caches hold it, and the build handles all three:

| Cache | How a new icon gets through |
| --- | --- |
| Browser HTTP cache | Every icon URL carries `?v=<content hash>`, written into the built manifest and `index.html` at build time. New art, new URL. `.htaccess` also keeps icons at a one-day `must-revalidate` rather than the year-long `immutable` used for content-hashed assets. |
| Service worker | The page and the manifest are served **network-first** with a cache fallback, so a deploy is picked up on the next load rather than the one after it. The shell cache name is a hash of the built files' **contents**, so any change rolls it, and the old cache is deleted on activate. Precache requests use `cache: "reload"`, so the install cannot copy a stale HTTP-cached icon into a fresh cache. |
| Android WebAPK | Chrome only refetches a WebAPK when the manifest changes. Because the icon URLs are version-stamped, replacing the art *is* a manifest change, so Chrome picks it up on its next update check — within about a day. A reinstall is the immediate path, but see the warning below. |

**Uninstalling the app does not clear the site's data.** The service worker
stays registered with its cache, so a reinstall can be minted from whatever
manifest that worker serves. That is why the manifest is network-first: an
installed worker several deploys old would otherwise hand Chrome an old
manifest, with the old icons and the old share target, and no amount of
versioning inside that manifest could help. If an install ever does pick up
stale metadata, clear site data for the origin (Chrome → site settings →
Clear & reset) before reinstalling.

The version is derived from the contents of `public/icons/`, so it is stable
across rebuilds and changes only when the art does. Nothing to bump by hand.

A unit test asserts every precached icon is version-stamped and that the
`immutable` cache rule applies only to filenames containing a content hash.
`npm run verify` additionally alters the built manifest behind a running
worker and checks the change is served on the next load — the exact scenario
that once shipped a stale icon.

## Verification

`npm test` covers the parser, renderer, document pipeline and deployment
config, but it cannot exercise a service worker, a share POST, offline mode or
the CSP. `npm run verify` does, against the real production build:

```bash
npm run build
npm install --no-save puppeteer-core   # not a project dependency
npm run verify
```

It serves `dist/` with exactly the headers `.htaccess` sets, drives Chrome
(`CHROME_PATH` to override the binary), and checks the shell, the file picker,
rendering of `TEST.md`, print CSS, the four share-target outcomes, share
cleanup, offline loading, and that no CSP violation or page error occurs.

## Installing on Android Chrome

1. Serve the contents of `dist/` over **HTTPS** (a service worker and the share
   target both require a secure context; `localhost` also counts).
2. Open the site in Android Chrome.
3. Use the ⋮ menu → **Add to Home screen** / **Install app**.

Once installed, the application works with no network connection. Images that a
document links to over the network will still fail offline — the application
does, and must, keep working around them.

## Android share target

The manifest declares a share target:

```text
File manager → Share → Markdown Reader → the document opens
```

Mechanically:

1. Android POSTs a `multipart/form-data` request to `share-target`.
2. The service worker intercepts the POST, pulls the `file` field out of the
   form data, and validates the filename.
3. The file is parked in the Cache API and the worker answers with a **303
   redirect** to the normal application URL plus a short status flag.
4. The page collects the parked file, deletes it from the cache, and clears the
   flag from the URL with `history.replaceState`.
5. The file enters `documentFromFile()` — the same path a picked file takes.

Because the response to the POST is a redirect, refreshing or navigating back
never resubmits the share. Nothing about the document is ever put in the URL.

If the share contains no file, or a file that is not `.md`/`.markdown`, the
reader shows a one-line message instead.

### Why the manifest accepts more than Markdown

`share_target.params.files[].accept` looks broader than it should be:

```json
["text/markdown", "text/x-markdown", "text/plain", "text/*",
 "application/octet-stream", ".md", ".markdown"]
```

That list is not what the reader opens — it is what makes it *appear in the
Android share sheet at all*. Android decides which apps to offer from the MIME
type of the shared item, and `.md` has no registered type on Android: a file
manager sharing `notes.md` typically sends `text/plain` or, very often,
`application/octet-stream`. An app that accepts only `text/markdown` is never
offered, because nothing ever sends that.

The extension is still the thing that decides. The service worker validates the
filename when the share arrives and refuses anything that is not `.md` or
`.markdown` with a plain message, so a wrongly shared file is rejected at the
door rather than silently rendered.

### If the app is not in the share sheet

The entry comes from an Android intent filter that is **baked into the WebAPK
when the app is installed**. Changing the manifest on the server does not change
an app that is already installed — Chrome checks for manifest changes at most
once a day and then requests a rebuilt WebAPK, which can take another day to
arrive.

To get it immediately:

1. Uninstall Markdown Reader (long-press the icon → Uninstall / App info →
   Uninstall).
2. In Chrome: Settings → Privacy and security → Delete browsing data → Cookies
   and site data, or clear site data for just this origin from the padlock
   menu. This drops the cached manifest and the old service worker.
3. Reload the site and install it again from the ⋮ menu.

To check what is actually installed, open `chrome://webapks` on the device. The
app should be listed there — if it is not, what was added to the home screen is
a plain shortcut, not a WebAPK, and no share target will ever work. That page
also shows the manifest URL Chrome recorded and when it last checked for an
update.

Two other things worth confirming:

- The site is served over **HTTPS with a valid certificate**. A share target
  needs a secure context, and Chrome will not mint a WebAPK without one.
- `manifest.webmanifest` is reachable and served as
  `application/manifest+json` — the `.htaccess` in `dist/` sets that, so check
  it was actually uploaded (it is a dotfile and some SFTP clients hide it):
  `curl -sI https://example.com/manifest.webmanifest`.

## Supported Markdown

A deliberate subset, hand-written — no Markdown library is used.

**Blocks:** ATX headings (`#`–`######`), paragraphs, unordered lists (`-`, `*`,
`+`), ordered lists (including a non-1 start), nested lists, task lists
(`- [ ]`, `- [x]`), blockquotes (nestable, containing other blocks), fenced
code blocks with an info string, horizontal rules, and pipe tables with
alignment.

**Inline:** emphasis, strong emphasis, `***both***`, inline code (including
multi-backtick spans), links with optional titles, images, strikethrough, hard
line breaks, and backslash escapes.

**Not supported:** setext headings (`===` underlines), indented (four-space)
code blocks, reference-style links and footnotes, definition lists, raw HTML,
and autolinks written as `<https://…>` (a bare URL in angle brackets renders as
text). Leading tabs are expanded to four spaces before parsing.

## Security

The threat model is small and specific: **the document is the attacker.** A
Markdown file can arrive from anywhere — a download, a messaging app, a share
from another application — and the reader has to render it without letting it
run anything, reach anywhere, or hang the tab. There is no server, no account
and no stored user data, so most of the usual web attack surface does not
exist here.

### Injection

- The renderer builds DOM nodes. It never touches `innerHTML`, never
  concatenates markup, and never has a string of HTML to parse. Document text
  can only become a text node, so `<script>alert("x")</script>` in a document is
  displayed, not executed.
- Attributes are set with `setAttribute` from a fixed set of names, so nothing
  in a document can introduce an attribute the renderer does not already emit —
  an `onerror` cannot appear, whatever the input. A test asserts the produced
  tree against an allowlist of tags and attributes.
- Table alignment is a CSS class rather than a `style` attribute, so the
  deployed policy can forbid inline styles outright.
- HTML entities are not decoded, so `&lt;` in a document stays visible text.

### URLs

- A link URL must be relative or use `http`, `https`, `mailto` or `tel`.
  Everything else — `javascript:`, `vbscript:`, `data:text/html`, `file:`,
  `blob:`, `intent:` — is dropped and the link text kept as plain text.
- Whitespace and control characters are stripped before the scheme is examined,
  because browsers ignore them inside one: `java\nscript:` is a live URL.
- Images additionally accept `data:image/...` for raster types. SVG is excluded:
  it is an active document type.
- External links get `target="_blank"` with `rel="noopener noreferrer"`, and
  the server sends `Referrer-Policy: no-referrer`.

### Denial of service

A document is parsed synchronously on the UI thread, so a pathological one must
not be able to take the tab down with it.

- No pattern in the parser uses a nested quantifier or a lazy quantifier
  followed by an optional tail. Those shapes made two inputs — a line of
  `- - - …` and a heading with a long run of trailing spaces — take seconds or
  overflow V8's regex stack. Both are now linear scans.
- Container nesting is capped at 32 levels. `- - - - …` is a list inside a list
  inside a list; without the cap a few thousand markers exhausted the call
  stack.
- Link labels, destinations and titles are bounded (999 / 2048 / 1024
  characters, the first being CommonMark's own limit), and a link with no
  closing parenthesis in reach fails immediately. Without those bounds a
  document of `[a](` repeated was quadratic.
- Files over 8 MB are refused with a message rather than read.
- The test suite parses fifteen adversarial inputs under a time budget, so a
  regression in any of the above fails the build rather than the tab.

### Deployed headers

`public/.htaccess` sends, and a test keeps the policy in step with the copy
built into the page:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`, no inline script or style, `img-src 'self' data: https:`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Permissions-Policy` | camera, microphone, geolocation and the rest disabled |
| `Strict-Transport-Security` | `max-age=15552000` |

The CSP is real rather than decorative: the application has no inline script or
style, loads nothing from a third party, and makes no API calls, so `'self'`
with no `unsafe-inline` costs nothing. `img-src` allows `https:` only because
documents may legitimately reference remote images.

### Shared files

- The service worker validates the extension and size of a shared file before
  parking it, and normalises the filename — `../../etc/passwd.md` becomes
  `passwd.md` — before writing it into a response header.
- The share POST is answered with a 303 to a normal URL, so a refresh or a back
  navigation cannot resubmit the document.
- A parked document is deleted as it is read, and any document left behind by a
  share that was never opened is purged the next time the app starts. Nothing
  of the user's document remains in storage.
- The runtime cache only ever stores the application's own files.

### Supply chain

Zero runtime dependencies: nothing the browser executes comes from anyone else.
The four development dependencies (Vite, TypeScript, esbuild, `@types/node`)
are not part of the shipped output. `npm audit` reports no vulnerabilities and
retire.js finds nothing in `dist/`.

### Accepted risks

- **Remote images are a privacy signal.** A document that references
  `https://someone-elses-host/pixel.png` reveals that it was opened, and to
  which IP. Blocking remote images would break legitimate documents; the
  trade-off is deliberate, and the app never sends anything else.
- **`upgrade-insecure-requests`** silently rewrites `http:` image URLs in a
  document to `https:`. Without it those images would simply be blocked as
  mixed content.
- **The 8 MB limit is generous.** A 7 MB document will still block the UI
  thread for a noticeable moment while it parses.

This is a small boundary appropriate to a reader, not a general sanitisation
framework.

## Architecture

```text
File picker ─┐
             ├─> MarkdownDocument ─> parseMarkdown() ─> AST ─> renderDocument() ─> DOM
Share target ┘
```

```text
.
├── index.html
├── vite.config.ts          Vite config + the service-worker build plugin
├── public/
│   ├── .htaccess           Apache config: HTTPS, MIME types, caching, headers
│   ├── manifest.webmanifest
│   └── icons/              icon.svg and maskable.svg, plus rendered PNGs
├── src/
│   ├── main.ts             UI wiring; the only place that knows about buttons
│   ├── style.css           screen and print styling
│   ├── document/document.ts  MarkdownDocument, extension validation, file reading
│   ├── input/
│   │   ├── file-picker.ts  File System Access API, falling back to <input type=file>
│   │   └── share-target.ts collects a shared file parked by the service worker
│   ├── markdown/
│   │   ├── ast.ts          the document model
│   │   ├── parser.ts       block parsing
│   │   ├── inline.ts       inline parsing
│   │   ├── renderer.ts     model → DOM
│   │   ├── url.ts          URL safety
│   │   └── index.ts        public seam of the Markdown core
│   └── pwa/
│       ├── sw.ts           service worker: shell cache + share endpoint
│       ├── share-protocol.ts  constants shared by worker and page
│       └── register.ts
├── scripts/
│   ├── build-icons.mjs     renders the icon SVGs to PNG
│   ├── run-tests.mjs       bundles the tests and runs node --test
│   └── verify-build.mjs    drives Chrome against a production build
├── tests/
├── TEST.md                 the specification, used as a renderer fixture
└── README.md
```

Some decisions worth knowing:

- **The renderer reaches the DOM through a two-method interface** (`DomLike`)
  rather than the global `document`. That is what lets the tests assert on real
  rendered output without a browser or a DOM emulation dependency.
- **The service worker is built separately.** It has to sit at the site root as
  a standalone script and it needs the list of built files, which only exists
  after the bundle is written. A small Vite plugin bundles `src/pwa/sw.ts` with
  esbuild and injects the precache list; the cache name is a hash of that list,
  so an unchanged build produces an unchanged worker.
- **`base` is `./`**, so the build works at a domain root or under any subpath.
  Share-target paths are resolved against the service worker's scope for the
  same reason.
- **Cache strategy is deliberately plain**: precache the shell at install, serve
  same-origin requests cache-first, let cross-origin requests go to the network.
  A new build produces a new cache name and the old cache is deleted on
  activate.
- **The precache list excludes dotfiles, and a failed entry does not fail the
  install.** `.htaccess` sits in `dist/`, and Apache answers 403 for it;
  `cache.addAll` is all-or-nothing, so including it meant the install rejected
  and the site ran with no active service worker at all — no offline, and no
  share target, because the POST fell through to the server. The list now skips
  dotfiles, the install falls back to caching files individually if `addAll`
  fails, and both a unit test and `npm run verify` (whose server refuses `.ht*`
  exactly as Apache does) guard against it returning.

### Room for a v2 editor

The reader never mutates `MarkdownDocument.source`; parsing produces a separate
tree, and rendering produces separate DOM. An editor would sit beside the
renderer, consuming the same document:

```text
MarkdownDocument ─┬─> reader renderer
                  └─> (future) editor
```

No editor abstraction exists yet, because none is needed yet. The file picker
already uses the File System Access API where available, which is the handle a
future "save" would need.

## Known limitations

- **Chromium only.** Other engines may work but are not targeted; anything
  missing degrades to a message rather than a broken screen.
- **The share target needs the PWA to be installed** as a WebAPK and served
  over HTTPS. It is an Android/Chromium feature; desktop Chrome does not offer
  it in the same way, and it cannot be exercised from a development server over
  plain HTTP on a device. Because the intent filter is fixed at install time, a
  manifest change needs a reinstall — see
  [If the app is not in the share sheet](#if-the-app-is-not-in-the-share-sheet).
- **Text-only shares are not accepted.** Sharing a selection or a note as text,
  rather than sharing a file, will not offer this app: there is no document to
  open, and claiming otherwise would put the app in the share sheet for things
  it cannot read.
- **`showOpenFilePicker` is desktop-only.** Android Chrome uses the
  `<input type="file">` fallback, where the `.md`/`.markdown` filter is a hint
  to the file manager rather than a hard restriction — so the extension is
  re-validated after selection, in the loader.
- **No recent-document list.** Reloading the app shows the empty state again;
  the document is not retained anywhere.
- **External images require the network**, by definition. The application shell
  does not.
- **Documents are capped at 8 MB**, container nesting at 32 levels, and link
  labels/destinations/titles at 999/2048/1024 characters. These exist to keep a
  hostile document from hanging the tab; no hand-written document comes close.
- **HTML entities are not decoded.** `&amp;` in a document is shown as written.

## Testing

`npm test` bundles the TypeScript test files with esbuild and runs them under
Node's built-in test runner — no test framework is installed. Four suites:

- `markdown.test.ts` — the supported syntax, rendered and compared as markup.
- `security.test.ts` — injection vectors, URL schemes, attribute escaping,
  filename handling, and time budgets for adversarial documents.
- `document.test.ts` — the shared document-loading path.
- `deployment.test.ts` — that the page's CSP and the server's CSP agree, the
  security headers and cache rules are present, the manifest declares a valid
  share target, and the built output references nothing remote. The two checks
  that read `dist/` skip themselves with a note when there is no build yet, so
  the suite passes on a fresh clone.

`npm run verify` adds the browser-level checks described under
[Verification](#verification).

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

- **Build and test** on Node 18, 20 and 22 — `npm ci`, then `npm run build`
  (which type-checks the app and the service worker separately), then
  `npm test`. The build runs first so the two tests that inspect `dist/`
  execute rather than skipping.
- **Browser verification** — the same production build driven through Chrome by
  `npm run verify`, covering the service worker, the share target, offline
  loading, print CSS and the Content-Security-Policy.

Dependabot proposes toolchain updates weekly, grouped into one pull request,
plus updates to the actions themselves. Since nothing here ships at runtime, a
green CI run is the whole review for a dependency bump.

## License

MIT — see [LICENSE](LICENSE).
