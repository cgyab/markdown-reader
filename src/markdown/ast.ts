/**
 * The document model.
 *
 * Parsing produces this tree; rendering consumes it. Nothing in here knows
 * about the DOM, the browser, or the application UI. A future editor would
 * work against the same tree (or against the untouched source string).
 */

export type Align = "left" | "center" | "right" | null;

export interface HeadingBlock {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  inline: InlineNode[];
}

export interface ParagraphBlock {
  type: "paragraph";
  inline: InlineNode[];
}

export interface CodeBlock {
  type: "code";
  lang: string | null;
  text: string;
}

export interface QuoteBlock {
  type: "blockquote";
  blocks: Block[];
}

export interface ListItem {
  /** null when the item is not a task-list item. */
  checked: boolean | null;
  blocks: Block[];
}

export interface ListBlock {
  type: "list";
  ordered: boolean;
  start: number;
  /** No blank lines between items: paragraphs inside items are unwrapped. */
  tight: boolean;
  items: ListItem[];
}

export interface TableBlock {
  type: "table";
  align: Align[];
  header: InlineNode[][];
  rows: InlineNode[][][];
}

export interface RuleBlock {
  type: "rule";
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | QuoteBlock
  | ListBlock
  | TableBlock
  | RuleBlock;

export interface TextNode {
  type: "text";
  value: string;
}

export interface CodeSpanNode {
  type: "codespan";
  value: string;
}

export interface EmphasisNode {
  type: "emphasis" | "strong" | "strike";
  children: InlineNode[];
}

export interface LinkNode {
  type: "link";
  /** Already validated; unsafe schemes never reach the tree. */
  href: string;
  title: string | null;
  children: InlineNode[];
}

export interface ImageNode {
  type: "image";
  src: string;
  alt: string;
  title: string | null;
}

export interface BreakNode {
  type: "break";
}

export type InlineNode =
  | TextNode
  | CodeSpanNode
  | EmphasisNode
  | LinkNode
  | ImageNode
  | BreakNode;

/** A parsed document: the source is kept so a future editor can round-trip it. */
export interface ParsedDocument {
  blocks: Block[];
  /** First level-1 heading, when the document opens with one. */
  title: string | null;
}
