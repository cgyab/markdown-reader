/**
 * Block parser.
 *
 *   source text -> normalisation -> block parsing -> inline parsing -> AST
 *
 * Blocks are found by walking lines with a cursor; container blocks
 * (blockquotes, list items) strip their own prefix and recurse. Inline parsing
 * happens at the leaves, in `inline.ts`.
 */

import type { Align, Block, InlineNode, ListItem, ParsedDocument } from "./ast.js";
import { parseInline, plainText } from "./inline.js";

// No lazy quantifiers here: every pattern in this file has to stay linear in
// the length of a line, because documents are untrusted input.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
/**
 * Strips the optional closing run of hashes from `## Heading ##`.
 *
 * A scan rather than a pattern like `/[ \t]+#+[ \t]*$/`: that one can start
 * matching at any of the trailing spaces on a line, which is quadratic on a
 * heading that ends in a long run of them.
 */
function stripClosingHashes(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith("#")) return trimmed;

  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end -= 1;
  if (end === 0) return ""; // the heading was nothing but hashes
  if (trimmed[end - 1] !== " " && trimmed[end - 1] !== "\t") return trimmed;
  return trimmed.slice(0, end).trimEnd();
}
const FENCE = /^ {0,3}(`{3,})\s*([^`]*)$/;
const QUOTE = /^ {0,3}>\s?/;
const BULLET = /^(\s*)([-*+])(\s+|$)/;
const ORDERED = /^(\s*)(\d{1,9})[.)](\s+|$)/;
const TASK = /^\[([ xX])\]\s+/;
const DIVIDER_CELL = /^:?-+:?$/;

/**
 * How deeply containers may nest. Each level of blockquote or list recurses,
 * and a line such as `- - - - …` is a list inside a list inside a list: without
 * a limit, a few thousand markers exhaust the call stack. Past this depth the
 * remaining text is kept as paragraphs, so nothing is lost from view.
 */
const MAX_BLOCK_DEPTH = 32;

/**
 * Thematic break: three or more of the same marker, spaces allowed between.
 *
 * Written as a scan rather than a pattern like `(?:-\s*){3,}`. Nested
 * quantifiers of that shape make V8's regex engine recurse once per
 * repetition, and a line of a few thousand markers — which a document can
 * simply contain — overflows the stack. Every pattern here stays flat for the
 * same reason.
 */
function isRule(line: string): boolean {
  if (leadingSpaces(line) > 3) return false;
  const text = line.trim();
  const marker = text[0];
  if (marker !== "-" && marker !== "*" && marker !== "_") return false;

  let count = 0;
  for (const char of text) {
    if (char === marker) count += 1;
    else if (char !== " " && char !== "\t") return false;
  }
  return count >= 3;
}

/** The `| --- | :-: |` line under a table header. */
function isTableDivider(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell));
}

/**
 * Normalises line endings and leading tabs. Tabs become four spaces so that
 * indentation arithmetic in list parsing has a single unit to work with.
 */
function normalise(source: string): string[] {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
}

export function parseMarkdown(source: string): ParsedDocument {
  const blocks = parseBlocks(normalise(source));
  const heading = blocks.find((block) => block.type === "heading" && block.level === 1);
  const title = heading && heading.type === "heading" ? inlineText(heading.inline) : null;
  return { blocks, title };
}

function inlineText(nodes: InlineNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "codespan") text += node.value;
    else if (node.type === "image") text += node.alt;
    else if (node.type === "break") text += " ";
    else text += inlineText(node.children);
  }
  return text.trim();
}

export function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  const nestable = depth < MAX_BLOCK_DEPTH;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, ticks, info] = fence;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}\`{${ticks.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence, or the end of the document
      blocks.push({ type: "code", lang: info.trim() || null, text: body.join("\n") });
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        inline: parseInline(stripClosingHashes(heading[2] ?? "").trim()),
      });
      i += 1;
      continue;
    }

    if (nestable && QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        if (QUOTE.test(lines[i])) {
          body.push(lines[i].replace(QUOTE, ""));
          i += 1;
        } else if (lines[i].trim() !== "" && !startsBlock(lines[i])) {
          body.push(lines[i]); // lazy continuation of the quoted paragraph
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({ type: "blockquote", blocks: parseBlocks(body, depth + 1) });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const table = readTable(lines, i);
      if (table) {
        blocks.push(table.block);
        i = table.end;
        continue;
      }
    }

    if (nestable && (BULLET.test(line) || ORDERED.test(line))) {
      const list = readList(lines, i, depth);
      blocks.push(list.block);
      i = list.end;
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      (!nestable || !startsBlock(lines[i]))
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inline: parseInline(paragraph.join("\n")) });
    } else {
      i += 1; // a block starter that produced nothing; never loop on it
    }
  }

  return blocks;
}

/** True when a line interrupts an open paragraph. */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    isRule(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}

interface TableResult {
  block: Block;
  end: number;
}

function readTable(lines: string[], start: number): TableResult | null {
  const header = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map(toAlign);
  if (header.length === 0 || header.length !== align.length) return null;

  const rows: InlineNode[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
    const cells = splitRow(lines[i]);
    // Ragged rows are padded or trimmed rather than rejected.
    const row: InlineNode[][] = [];
    for (let column = 0; column < header.length; column += 1) {
      row.push(parseInline(cells[column] ?? ""));
    }
    rows.push(row);
    i += 1;
  }

  return {
    block: { type: "table", align, header: header.map(parseInline), rows },
    end: i,
  };
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (text[i] === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += text[i];
  }
  cells.push(cell.trim());
  return cells;
}

function toAlign(spec: string): Align {
  const left = spec.startsWith(":");
  const right = spec.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

interface ListResult {
  block: Block;
  end: number;
}

function readList(lines: string[], start: number, depth: number): ListResult {
  const first = (BULLET.exec(lines[start]) ?? ORDERED.exec(lines[start])) as RegExpExecArray;
  const ordered = ORDERED.test(lines[start]);
  const indent = first[1].length;
  const startNumber = ordered ? Number(first[2]) : 1;
  // A change of marker character starts a new list, as in CommonMark.
  const bullet = ordered ? null : first[2];

  const items: ListItem[] = [];
  let tight = true;
  let i = start;

  while (i < lines.length) {
    const match = BULLET.exec(lines[i]) ?? ORDERED.exec(lines[i]);
    if (!match || match[1].length !== indent) break;
    if (ORDERED.test(lines[i]) !== ordered) break;
    if (bullet !== null && match[2] !== bullet) break;

    const marker = match[0].length;
    const body = [lines[i].slice(marker)];
    i += 1;

    // Continuation lines belong to the item while they stay indented past the
    // marker, or while they lazily continue its paragraph.
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        const next = lines[i + 1];
        if (next !== undefined && next.trim() !== "" && leadingSpaces(next) >= marker) {
          body.push("");
          tight = false;
          i += 1;
          continue;
        }
        break;
      }
      if (leadingSpaces(line) >= marker) {
        body.push(line.slice(marker));
        i += 1;
        continue;
      }
      if (!startsBlock(line)) {
        body.push(line.trim());
        i += 1;
        continue;
      }
      break;
    }

    items.push(readItem(body, depth + 1));

    // A blank line before the next item of the same list makes it loose.
    let lookahead = i;
    while (lookahead < lines.length && lines[lookahead].trim() === "") lookahead += 1;
    if (lookahead > i && lookahead < lines.length && continuesList(lines[lookahead], indent, ordered, bullet)) {
      tight = false;
      i = lookahead;
    }
  }

  return { block: { type: "list", ordered, start: startNumber, tight, items }, end: i };
}

/** True when a line opens another item of the list currently being read. */
function continuesList(
  line: string,
  indent: number,
  ordered: boolean,
  bullet: string | null,
): boolean {
  const match = BULLET.exec(line) ?? ORDERED.exec(line);
  if (!match || match[1].length !== indent) return false;
  if (ORDERED.test(line) !== ordered) return false;
  return bullet === null || match[2] === bullet;
}

function readItem(body: string[], depth: number): ListItem {
  let checked: boolean | null = null;
  const task = TASK.exec(body[0] ?? "");
  if (task) {
    checked = task[1].toLowerCase() === "x";
    body = [body[0].replace(TASK, ""), ...body.slice(1)];
  }
  return { checked, blocks: parseBlocks(body, depth) };
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

export { plainText };
