/**
 * Public seam of the Markdown core.
 *
 * Everything below this module is free of application, browser-UI and PWA
 * concerns: give it a string, get a document model or DOM nodes back.
 */

export type { Block, InlineNode, ParsedDocument } from "./ast.js";
export { parseMarkdown } from "./parser.js";
export { browserDom, renderDocument } from "./renderer.js";
export type { DomLike, ElementLike } from "./renderer.js";
