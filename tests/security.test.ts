/**
 * Security tests.
 *
 * Every Markdown document is untrusted input. These tests fire a battery of
 * injection vectors at the renderer and assert on the rendered markup: no
 * element that can execute, no event-handler attribute, no dangerous URL, and
 * no way out of an attribute. They also put a time budget on parsing, so a
 * pathological document cannot lock up the tab.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MAX_DOCUMENT_BYTES, documentFromFile, safeDisplayName } from "../src/document/document.js";
import { parseMarkdown } from "../src/markdown/parser.js";
import { renderDocument } from "../src/markdown/renderer.js";
import { safeImageUrl, safeLinkUrl } from "../src/markdown/url.js";
import { attributesOf, fakeDom, html, tagsOf } from "./fake-dom.js";

function render(markdown: string): string {
  return html(renderDocument(fakeDom, parseMarkdown(markdown)));
}

/**
 * The complete set of elements and attributes the renderer is allowed to
 * produce. Asserting against the tree rather than against serialised markup
 * matters: escaped text legitimately contains strings like `onerror=`, and a
 * markup regex cannot tell that from a real attribute.
 */
const ALLOWED_TAGS = new Set([
  "article", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "input",
  "blockquote", "pre", "code", "hr", "div", "table", "thead", "tbody", "tr",
  "th", "td", "em", "strong", "del", "a", "img", "br",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "href", "src", "alt", "title", "class", "type", "disabled", "checked",
  "aria-label", "loading", "data-lang", "start", "target", "rel",
]);

/** Asserts that a document produced nothing that can execute or navigate badly. */
function assertInert(markdown: string, vector: string): void {
  const tree = renderDocument(fakeDom, parseMarkdown(markdown));

  for (const tag of tagsOf(tree)) {
    assert.ok(ALLOWED_TAGS.has(tag), `unexpected <${tag}> element from: ${vector}`);
  }

  for (const [tag, name, value] of attributesOf(tree)) {
    assert.ok(
      ALLOWED_ATTRIBUTES.has(name),
      `unexpected attribute ${name} on <${tag}> from: ${vector}`,
    );
    assert.ok(!/^on/i.test(name), `event handler ${name} from: ${vector}`);
    if (name === "href" || name === "src") {
      assert.ok(
        !/^\s*(javascript|vbscript|data:text\/html|file|blob|about|chrome|intent)/i.test(value),
        `dangerous URL ${value} from: ${vector}`,
      );
    }
  }
}

test("HTML injection vectors are rendered as text", () => {
  const vectors = [
    '<script>alert("x")</script>',
    "<SCRIPT SRC=https://evil.example/x.js></SCRIPT>",
    "<img src=x onerror=alert(1)>",
    '<img src="x" onerror="alert(1)">',
    "<svg/onload=alert(1)>",
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload="alert(1)">',
    "<a href=\"javascript:alert(1)\">click</a>",
    '<form action="https://evil.example"><input name="a"></form>',
    "<object data=x></object>",
    "<embed src=x>",
    "<style>body{background:url(javascript:alert(1))}</style>",
    "<!--[if IE]><script>alert(1)</script><![endif]-->",
    "<div onmouseover=alert(1)>hover</div>",
    "<math><mtext><script>alert(1)</script></mtext></math>",
  ];

  for (const vector of vectors) {
    assertInert(vector, vector);
    // The text itself survives, escaped, so nothing silently disappears.
    assert.ok(render(vector).includes("&lt;"), `expected escaped markup from: ${vector}`);
  }
});

test("HTML inside every block context stays inert", () => {
  const vectors = [
    "# <img src=x onerror=alert(1)>",
    "> <script>alert(1)</script>",
    "- <img src=x onerror=alert(1)>",
    "1. <svg/onload=alert(1)>",
    "| a | b |\n| --- | --- |\n| <img src=x onerror=alert(1)> | b |",
    "**<script>alert(1)</script>**",
    "[<script>alert(1)</script>](https://example.com)",
    "![<script>alert(1)</script>](x.png)",
    "```\n<script>alert(1)</script>\n```",
    "`<script>alert(1)</script>`",
  ];

  for (const vector of vectors) {
    assertInert(vector, vector);
  }
});

test("dangerous link schemes never become live links", () => {
  const vectors = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    " javascript:alert(1)",
    "\u0000javascript:alert(1)",
    "\u000bjavascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "file:///etc/passwd",
    "blob:https://example.com/abc",
    "about:blank",
    "chrome://settings",
    "intent://scan/#Intent;scheme=zxing;end",
  ];

  for (const vector of vectors) {
    assert.equal(safeLinkUrl(vector), null, `link scheme allowed: ${vector}`);
    assertInert(`[click](${vector})`, vector);
    assert.ok(!render(`[click](${vector})`).includes("<a "), `anchor created for: ${vector}`);
  }
});

test("safe schemes and relative URLs are preserved", () => {
  for (const url of [
    "https://example.com/a?b=c#d",
    "http://example.com",
    "mailto:someone@example.com",
    "tel:+15550100",
    "./relative.md",
    "../up.md",
    "#fragment",
    "/absolute/path",
    "//example.com/protocol-relative",
  ]) {
    assert.equal(safeLinkUrl(url), url, `safe URL rejected: ${url}`);
  }
});

test("images allow raster data URLs but not SVG or HTML", () => {
  assert.ok(safeImageUrl("data:image/png;base64,AAAA"));
  assert.ok(safeImageUrl("data:image/webp;base64,AAAA"));
  // SVG is an active document type, so it is not accepted even as an image.
  assert.equal(safeImageUrl("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(safeImageUrl("data:text/html;base64,AAAA"), null);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
});

test("nothing can break out of an attribute", () => {
  const vectors = [
    '[x](https://example.com/" onmouseover="alert(1))',
    '[x](https://example.com "a\\" onmouseover=\\"alert(1)")',
    '![x](https://example.com/i.png "b\\" onerror=\\"alert(1)")',
    '![" onerror="alert(1)](https://example.com/i.png)',
    "[x](https://example.com/'onclick='alert(1))",
    "[x](https://example.com/<script>)",
  ];

  for (const vector of vectors) {
    assertInert(vector, vector);
  }

  // And a quote that does reach an attribute value comes back out escaped.
  const markup = render('![a " onerror=" b](https://example.com/i.png)');
  assert.ok(markup.includes('alt="a &quot; onerror=&quot; b"'), markup);
});

test("external links are opened without handing over the opener", () => {
  const markup = render("[x](https://example.com)");
  assert.ok(markup.includes('rel="noopener noreferrer"'));
});

test("filenames are reduced to a plain name", () => {
  assert.equal(safeDisplayName("../../etc/passwd.md"), "passwd.md");
  assert.equal(safeDisplayName("C:\\Users\\a\\notes.md"), "notes.md");
  assert.equal(safeDisplayName("notes\r\nX-Injected: 1.md"), "notesX-Injected: 1.md");
  assert.equal(safeDisplayName("a".repeat(500)).length, 120);
});

test("oversized documents are refused rather than parsed", async () => {
  const huge = {
    name: "big.md",
    size: MAX_DOCUMENT_BYTES + 1,
    text: async () => "# never read",
  } as unknown as File;

  await assert.rejects(() => documentFromFile(huge), /too large/);
});

/**
 * Budgets, not benchmarks: each of these inputs would take minutes rather than
 * milliseconds if a pattern in the parser backtracked catastrophically.
 */
test("pathological documents parse in linear time", () => {
  const inputs: Array<[string, string]> = [
    ["emphasis run", "*".repeat(20_000)],
    ["mixed emphasis", "*_~".repeat(8_000)],
    ["unclosed brackets", "[".repeat(20_000)],
    ["bracket pairs", "[x]".repeat(10_000)],
    ["unclosed code spans", "`".repeat(20_000)],
    ["heading with trailing space", `# ${"a".repeat(20_000)}${" ".repeat(20_000)}`],
    ["hash run", "#".repeat(20_000)],
    ["rule candidates", `${"- ".repeat(10_000)}x`],
    ["table dividers", `${"|:-".repeat(10_000)}x`],
    ["pipe row", `${"|a".repeat(10_000)}\n|---|\n|b|`],
    ["deep list indent", Array.from({ length: 2_000 }, (_, i) => `${" ".repeat(i % 40)}- x`).join("\n")],
    ["long lines", `${"a".repeat(200_000)}\n\n${"b".repeat(200_000)}`],
    ["escapes", "\\*".repeat(20_000)],
    ["link openers", "[a](".repeat(10_000)],
    ["blockquote depth", `${"> ".repeat(200)}x`],
  ];

  for (const [name, input] of inputs) {
    const started = process.hrtime.bigint();
    assert.doesNotThrow(() => parseMarkdown(input), name);
    const millis = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(millis < 2_000, `${name} took ${millis.toFixed(0)}ms`);
  }
});

test("a large realistic document renders within budget", () => {
  const section = [
    "# Heading",
    "",
    "Paragraph with **bold**, *italic*, `code` and a [link](https://example.com).",
    "",
    "- item one",
    "- item two",
    "  - nested",
    "",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "> quoted",
    "",
  ].join("\n");

  const document = section.repeat(2_000); // roughly 400 kB
  const started = process.hrtime.bigint();
  const markup = render(document);
  const millis = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(markup.length > 0);
  assert.ok(millis < 5_000, `rendering took ${millis.toFixed(0)}ms`);
});
