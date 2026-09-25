/**
 * Renderer behaviour tests: Markdown in, markup out.
 *
 * These assert on what a reader ends up seeing rather than on parser
 * internals, so the parsing strategy can change without rewriting the suite.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseMarkdown } from "../src/markdown/parser.js";
import { renderDocument } from "../src/markdown/renderer.js";
import { fakeDom, html } from "./fake-dom.js";

/** Renders Markdown to markup, without the wrapping <article>. */
function render(markdown: string): string {
  const rendered = html(renderDocument(fakeDom, parseMarkdown(markdown)));
  return rendered.replace(/^<article>/, "").replace(/<\/article>$/, "");
}

test("empty documents render nothing", () => {
  assert.equal(render(""), "");
  assert.equal(render("\n\n   \n"), "");
});

test("headings use levels one through six", () => {
  assert.equal(render("# One"), '<h1 id="one">One</h1>');
  assert.equal(render("###### Six"), '<h6 id="six">Six</h6>');
  assert.equal(render("####### Seven"), "<p>####### Seven</p>");
  assert.equal(render("## Closed ##"), '<h2 id="closed">Closed</h2>');
});

test("headings carry the anchor an author would link to", () => {
  // The convention people write by hand: lower case, punctuation dropped,
  // spaces hyphenated.
  assert.equal(render("# 1. Hard Requirements"), '<h1 id="1-hard-requirements">1. Hard Requirements</h1>');
  assert.equal(render("## What's *new*?"), '<h2 id="whats-new">What\u2019s <em>new</em>?</h2>'.replace("\u2019", "'"));
  assert.equal(render("### snake_case and dashes-too"), '<h3 id="snake_case-and-dashes-too">snake_case and dashes-too</h3>');
  assert.equal(render("## `code` in a heading"), '<h2 id="code-in-a-heading"><code>code</code> in a heading</h2>');
});

test("repeated headings get distinct anchors", () => {
  assert.equal(
    render("## Notes\n\n## Notes\n\n## Notes"),
    '<h2 id="notes">Notes</h2><h2 id="notes-1">Notes</h2><h2 id="notes-2">Notes</h2>',
  );
});

test("a heading with nothing sluggable still gets an anchor", () => {
  assert.equal(render("## ???"), '<h2 id="section">???</h2>');
  assert.equal(render("## ???\n\n## !!!"), '<h2 id="section">???</h2><h2 id="section-1">!!!</h2>');
});

test("an in-document link and its heading meet", () => {
  const markup = render("[Go](#my-section)\n\n## My Section");
  assert.equal(markup, '<p><a href="#my-section">Go</a></p><h2 id="my-section">My Section</h2>');
});

test("headings nested in other blocks are still anchored and still unique", () => {
  assert.equal(
    render("> ## Quoted\n\n## Quoted"),
    '<blockquote><h2 id="quoted">Quoted</h2></blockquote><h2 id="quoted-1">Quoted</h2>',
  );
});

test("paragraphs are separated by blank lines and join wrapped lines", () => {
  assert.equal(render("one\ntwo\n\nthree"), "<p>one\ntwo</p><p>three</p>");
});

test("emphasis, strong and strikethrough", () => {
  assert.equal(render("*a* **b** ~~c~~"), "<p><em>a</em> <strong>b</strong> <del>c</del></p>");
  assert.equal(render("_a_ __b__"), "<p><em>a</em> <strong>b</strong></p>");
  assert.equal(render("***both***"), "<p><em><strong>both</strong></em></p>");
  assert.equal(render("snake_case_name"), "<p>snake_case_name</p>");
  assert.equal(render("a * b * c"), "<p>a * b * c</p>");
});

test("inline code is literal", () => {
  assert.equal(render("use `a*b*c`"), "<p>use <code>a*b*c</code></p>");
  assert.equal(render("``a ` b``"), "<p><code>a ` b</code></p>");
});

test("fenced code keeps its content and records the language", () => {
  const markdown = ["```typescript", "const a = 1 < 2;", "```"].join("\n");
  assert.equal(render(markdown), '<pre><code data-lang="typescript">const a = 1 &lt; 2;</code></pre>');
});

test("unfinished fences do not swallow the parser", () => {
  assert.equal(render("```\nunclosed"), "<pre><code>unclosed</code></pre>");
});

test("unordered lists accept all three markers", () => {
  assert.equal(render("- a\n* b\n+ c"), "<ul><li>a</li></ul><ul><li>b</li></ul><ul><li>c</li></ul>");
  assert.equal(render("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
});

test("ordered lists keep their starting number", () => {
  assert.equal(render("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
  assert.equal(render("3. a\n4. b"), '<ol start="3"><li>a</li><li>b</li></ol>');
});

test("nested lists become nested markup", () => {
  const markdown = ["- One", "- Two", "  - Nested A", "  - Nested B", "- Three"].join("\n");
  assert.equal(
    render(markdown),
    "<ul><li>One</li><li>Two<ul><li>Nested A</li><li>Nested B</li></ul></li><li>Three</li></ul>",
  );
});

test("task lists render disabled checkboxes", () => {
  const markdown = "- [ ] todo\n- [x] done";
  assert.equal(
    render(markdown),
    '<ul class="task-list">' +
      '<li><input type="checkbox" disabled aria-label="Not completed">todo</li>' +
      '<li><input type="checkbox" disabled checked aria-label="Completed">done</li>' +
      "</ul>",
  );
});

test("blockquotes contain blocks, including several paragraphs", () => {
  assert.equal(
    render("> first\n>\n> second"),
    "<blockquote><p>first</p><p>second</p></blockquote>",
  );
  assert.equal(render("> # quoted"), '<blockquote><h1 id="quoted">quoted</h1></blockquote>');
});

test("horizontal rules", () => {
  assert.equal(render("---"), "<hr>");
  assert.equal(render("* * *"), "<hr>");
  assert.equal(render("___"), "<hr>");
});

test("links render as anchors and mark external targets", () => {
  assert.equal(
    render("[Chromium](https://www.chromium.org/)"),
    '<p><a href="https://www.chromium.org/" target="_blank" rel="noopener noreferrer">Chromium</a></p>',
  );
  assert.equal(render("[anchor](#section)"), '<p><a href="#section">anchor</a></p>');
  assert.equal(
    render('[titled](https://example.com "Tip")'),
    '<p><a href="https://example.com" title="Tip" target="_blank" rel="noopener noreferrer">titled</a></p>',
  );
});

test("images render as images with alt text", () => {
  assert.equal(
    render("![a cat](cat.png)"),
    '<p><img src="cat.png" alt="a cat" loading="lazy"></p>',
  );
});

test("tables render with a head, body and alignment", () => {
  const markdown = [
    "| Feature | v1.0 |",
    "| :--- | ---: |",
    "| Reading | Yes |",
    "| Editing | No |",
  ].join("\n");
  assert.equal(
    render(markdown),
    '<div class="table-scroll"><table>' +
      '<thead><tr><th class="align-left">Feature</th><th class="align-right">v1.0</th></tr></thead>' +
      '<tbody>' +
      '<tr><td class="align-left">Reading</td><td class="align-right">Yes</td></tr>' +
      '<tr><td class="align-left">Editing</td><td class="align-right">No</td></tr>' +
      "</tbody></table></div>",
  );
});

test("escaped Markdown characters stay as text", () => {
  assert.equal(render("\\*not emphasis\\*"), "<p>*not emphasis*</p>");
  assert.equal(render("a \\| b"), "<p>a | b</p>");
});

test("HTML in a document is shown, never executed", () => {
  assert.equal(
    render('<script>alert("x")</script>'),
    "<p>&lt;script&gt;alert(\"x\")&lt;/script&gt;</p>",
  );
  assert.equal(
    render('<img src=x onerror="alert(1)">'),
    '<p>&lt;img src=x onerror="alert(1)"&gt;</p>',
  );
  assert.equal(render("`<b>bold</b>`"), "<p><code>&lt;b&gt;bold&lt;/b&gt;</code></p>");
});

test("dangerous URL schemes are dropped, keeping the text", () => {
  assert.equal(render("[click](javascript:alert(1))"), "<p>click</p>");
  assert.equal(render("[click](JaVaScRiPt:alert(1))"), "<p>click</p>");
  assert.equal(render("[click](java\tscript:alert(1))"), "<p>click</p>");
  assert.equal(render("[click](vbscript:msgbox)"), "<p>click</p>");
  assert.equal(render("![x](javascript:alert(1))"), "<p>x</p>");
  assert.equal(render("![x](data:text/html;base64,AAA)"), "<p>x</p>");
});

test("safe non-http schemes still work", () => {
  assert.equal(render("[mail](mailto:a@b.com)"), '<p><a href="mailto:a@b.com">mail</a></p>');
});

test("attribute values cannot break out of an attribute", () => {
  const rendered = render('[x](https://example.com/?a="onerror=alert(1))');
  assert.ok(rendered.includes("&quot;"), rendered);
  assert.ok(!rendered.includes('"onerror'), rendered);
});

test("the document title comes from the first level-one heading", () => {
  assert.equal(parseMarkdown("# Title\n\ntext").title, "Title");
  assert.equal(parseMarkdown("## Only a subheading").title, null);
});

test("malformed constructs do not crash the parser", () => {
  const nasty = [
    "[unclosed link](http://example.com",
    "| broken | table",
    "| --- |",
    "- [ ",
    "> ",
    "```",
    "*".repeat(200),
    "#".repeat(80),
    "[".repeat(50) + "]".repeat(50),
  ].join("\n");
  assert.doesNotThrow(() => render(nasty));
});

test("the specification document renders", () => {
  const source = readFileSync(new URL("../TEST.md", import.meta.url), "utf8");
  const parsed = parseMarkdown(source);
  const markup = html(renderDocument(fakeDom, parsed));

  assert.ok(parsed.blocks.length > 100, `only ${parsed.blocks.length} blocks`);
  assert.ok(/<h1 id="[^"]+">/.test(markup), "headings, each with an anchor");
  assert.ok(markup.includes("<pre><code"), "fenced code");
  assert.ok(markup.includes("<table>"), "tables");
  assert.ok(markup.includes("<ul>") && markup.includes("<ol>"), "lists");
  assert.ok(markup.includes("<blockquote>"), "blockquotes");
  assert.ok(markup.includes("<hr>"), "rules");
  assert.ok(markup.includes("<strong>") && markup.includes("<em>"), "emphasis");
  assert.ok(markup.includes('<a href="https://www.chromium.org/"'), "links");
  assert.ok(markup.includes('type="checkbox"'), "task lists");
  assert.ok(!/<script/i.test(markup), "no script element may reach the output");
});
