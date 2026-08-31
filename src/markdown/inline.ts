/**
 * Inline parser: a span of text becomes a small tree of inline nodes.
 *
 * This is a left-to-right scanner rather than a pile of regular expressions,
 * so nesting (`**bold with `code` inside**`) falls out of recursion instead of
 * needing ever-larger patterns. It knows nothing about the DOM.
 */

import type { InlineNode } from "./ast.js";
import { safeImageUrl, safeLinkUrl } from "./url.js";

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * CommonMark caps a link label at 999 characters. Honouring that cap is also
 * what keeps bracket matching linear: without it, a document made of nothing
 * but `[` rescans the remaining text for every one of them.
 */
const MAX_LINK_LABEL = 999;

/**
 * Caps on the other two parts of a link. A destination cannot contain
 * unescaped whitespace, so a runaway scan only happens on malformed input like
 * a document made of `[a](` — which without a cap is quadratic.
 */
const MAX_LINK_DESTINATION = 2048;
const MAX_LINK_TITLE = 1024;

function isAlphaNumeric(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Za-z]/.test(char);
}

/** Collects text nodes so consecutive characters become one node. */
class Buffer {
  private text = "";
  private readonly nodes: InlineNode[] = [];

  push(chunk: string): void {
    this.text += chunk;
  }

  node(node: InlineNode): void {
    this.flush();
    this.nodes.push(node);
  }

  private flush(): void {
    if (this.text !== "") {
      this.nodes.push({ type: "text", value: this.text });
      this.text = "";
    }
  }

  done(): InlineNode[] {
    this.flush();
    return this.nodes;
  }
}

export function parseInline(source: string): InlineNode[] {
  const out = new Buffer();
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (char === "\\" && ASCII_PUNCTUATION.test(source[i + 1] ?? "")) {
      out.push(source[i + 1]);
      i += 2;
      continue;
    }

    if (char === "`") {
      const span = readCodeSpan(source, i);
      if (span) {
        out.node({ type: "codespan", value: span.value });
        i = span.end;
        continue;
      }
    }

    if (char === "\n") {
      // Two trailing spaces (or a trailing backslash) mean a hard break.
      // Checked by character rather than by matching the whole prefix, which
      // would make parsing quadratic in the size of the document.
      const hard =
        source[i - 1] === "\\" || (source[i - 1] === " " && source[i - 2] === " ");
      if (hard) {
        out.node({ type: "break" });
      } else {
        out.push("\n");
      }
      i += 1;
      continue;
    }

    if (char === "!" && source[i + 1] === "[") {
      const image = readLink(source, i + 1);
      if (image) {
        const src = safeImageUrl(image.destination);
        if (src !== null) {
          out.node({ type: "image", src, alt: plainText(image.label), title: image.title });
        } else {
          // Unsafe source: keep the alt text so nothing silently disappears.
          out.push(image.label);
        }
        i = image.end;
        continue;
      }
    }

    if (char === "[") {
      const link = readLink(source, i);
      if (link) {
        const href = safeLinkUrl(link.destination);
        const children = parseInline(link.label);
        if (href !== null) {
          out.node({ type: "link", href, title: link.title, children });
        } else {
          // Unsafe scheme: the text survives, the navigation does not.
          for (const child of children) out.node(child);
        }
        i = link.end;
        continue;
      }
    }

    if (char === "*" || char === "_" || char === "~") {
      const emphasis = readEmphasis(source, i);
      if (emphasis) {
        out.node(emphasis.node);
        i = emphasis.end;
        continue;
      }
    }

    out.push(char);
    i += 1;
  }

  return out.done();
}

/** Renders an inline tree back to bare text (used for image alt text). */
export function plainText(source: string): string {
  return textOf(parseInline(source));
}

function textOf(nodes: InlineNode[]): string {
  let text = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "codespan":
        text += node.value;
        break;
      case "image":
        text += node.alt;
        break;
      case "break":
        text += " ";
        break;
      default:
        text += textOf(node.children);
    }
  }
  return text;
}

interface CodeSpan {
  value: string;
  end: number;
}

function readCodeSpan(source: string, start: number): CodeSpan | null {
  let fence = 0;
  while (source[start + fence] === "`") fence += 1;

  let i = start + fence;
  while (i < source.length) {
    if (source[i] !== "`") {
      i += 1;
      continue;
    }
    let run = 0;
    while (source[i + run] === "`") run += 1;
    if (run === fence) {
      let value = source.slice(start + fence, i).replace(/\n/g, " ");
      if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") {
        value = value.slice(1, -1);
      }
      return { value, end: i + fence };
    }
    i += run;
  }
  return null;
}

interface Link {
  label: string;
  destination: string;
  title: string | null;
  end: number;
}

/** Reads `[label](destination "title")` starting at the opening bracket. */
function readLink(source: string, start: number): Link | null {
  const labelEnd = matchBracket(source, start);
  if (labelEnd === -1 || source[labelEnd + 1] !== "(") return null;

  const label = source.slice(start + 1, labelEnd);
  let i = labelEnd + 2;

  // Every link needs a closing parenthesis within reach; checking for one up
  // front turns `[a](` repeated across a document from a scan per opener into
  // a single native search that fails immediately.
  const closing = source.indexOf(")", i);
  if (closing === -1 || closing > i + MAX_LINK_DESTINATION + MAX_LINK_TITLE) return null;

  while (source[i] === " " || source[i] === "\n") i += 1;

  let destination = "";
  if (source[i] === "<") {
    const close = source.indexOf(">", i);
    if (close === -1) return null;
    destination = source.slice(i + 1, close);
    i = close + 1;
  } else {
    const limit = Math.min(source.length, i + MAX_LINK_DESTINATION);
    let depth = 0;
    while (i < limit) {
      const char = source[i];
      if (char === "\\" && ASCII_PUNCTUATION.test(source[i + 1] ?? "")) {
        destination += source[i + 1];
        i += 2;
        continue;
      }
      if (char === " " || char === "\n") break;
      if (char === "(") depth += 1;
      if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      destination += char;
      i += 1;
    }
    // Ran past the cap without reaching a delimiter: not a link.
    if (i === limit && limit < source.length && !/[\s)]/.test(source[i] ?? "")) return null;
  }

  while (source[i] === " " || source[i] === "\n") i += 1;

  let title: string | null = null;
  const quote = source[i];
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, i + 1);
    if (close === -1 || close - i > MAX_LINK_TITLE) return null;
    title = source.slice(i + 1, close);
    i = close + 1;
    while (source[i] === " " || source[i] === "\n") i += 1;
  }

  if (source[i] !== ")") return null;
  return { label, destination, title, end: i + 1 };
}

/** Index of the `]` matching the `[` at `start`, or -1. */
function matchBracket(source: string, start: number): number {
  // Cheap rejections first: no closing bracket at all, or none close enough.
  const nearest = source.indexOf("]", start);
  if (nearest === -1) return -1;

  const limit = Math.min(source.length, start + MAX_LINK_LABEL + 2);
  let depth = 0;
  let i = start;
  while (i < limit) {
    const char = source[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "`") {
      const span = readCodeSpan(source, i);
      i = span ? span.end : i + 1;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

interface Emphasis {
  node: InlineNode;
  end: number;
}

function readEmphasis(source: string, start: number): Emphasis | null {
  const marker = source[start];
  let run = 0;
  while (source[start + run] === marker) run += 1;

  // `~` is only meaningful as a `~~strikethrough~~` pair.
  if (marker === "~" && run < 2) return null;
  // `_` does not open inside a word, so `snake_case_name` stays intact.
  if (marker === "_" && isAlphaNumeric(source[start - 1])) return null;

  // Widest match first: `***x***` is emphasis around strong emphasis.
  const widths = marker === "~" ? [2] : [3, 2, 1].filter((width) => width <= run);

  for (const width of widths) {
    const open = start + width;
    // An opener must be followed by content, not by whitespace.
    if (open >= source.length || /\s/.test(source[open])) continue;

    const close = findCloser(source, open, marker, width);
    if (close === -1) continue;
    if (marker === "_" && isAlphaNumeric(source[close + width])) continue;

    const children = parseInline(source.slice(open, close));
    return { node: wrap(marker, width, children), end: close + width };
  }

  return null;
}

function wrap(marker: string, width: number, children: InlineNode[]): InlineNode {
  if (marker === "~") return { type: "strike", children };
  if (width === 3) return { type: "emphasis", children: [{ type: "strong", children }] };
  return { type: width === 2 ? "strong" : "emphasis", children };
}

function findCloser(source: string, from: number, marker: string, width: number): number {
  let i = from;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "`") {
      const span = readCodeSpan(source, i);
      i = span ? span.end : i + 1;
      continue;
    }
    if (char === marker) {
      let run = 0;
      while (source[i + run] === marker) run += 1;
      // A closer must not be preceded by whitespace, and must be wide enough.
      if (run >= width && i > from && !/\s/.test(source[i - 1])) return i;
      i += run;
      continue;
    }
    i += 1;
  }
  return -1;
}
