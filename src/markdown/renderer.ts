/**
 * Renders the document model into DOM nodes.
 *
 * Security boundary: this module never assembles HTML strings and never
 * touches `innerHTML`. Every piece of document text becomes a text node and
 * every attribute is set through `setAttribute`, so markup inside a document
 * can only ever appear as visible characters. URLs have already been filtered
 * by `url.ts` before they reach the tree.
 *
 * The DOM is reached through a tiny interface rather than the global
 * `document`, which keeps the renderer testable outside a browser.
 */

import type { Block, InlineNode, ParsedDocument } from "./ast.js";
import { isExternal } from "./url.js";

export interface ElementLike {
  appendChild(child: unknown): unknown;
  setAttribute(name: string, value: string): void;
}

export interface DomLike {
  createElement(tag: string): ElementLike;
  createTextNode(text: string): unknown;
}

/** Adapts the browser's `document` to the interface above. */
export function browserDom(doc: Document): DomLike {
  return {
    createElement: (tag) => doc.createElement(tag),
    createTextNode: (text) => doc.createTextNode(text),
  };
}

export function renderDocument(dom: DomLike, parsed: ParsedDocument): ElementLike {
  const root = dom.createElement("article");
  appendBlocks(dom, root, parsed.blocks);
  return root;
}

function appendBlocks(dom: DomLike, parent: ElementLike, blocks: Block[]): void {
  for (const block of blocks) {
    parent.appendChild(renderBlock(dom, block));
  }
}

function renderBlock(dom: DomLike, block: Block): ElementLike {
  switch (block.type) {
    case "heading": {
      const element = dom.createElement(`h${block.level}`);
      appendInline(dom, element, block.inline);
      return element;
    }
    case "paragraph": {
      const element = dom.createElement("p");
      appendInline(dom, element, block.inline);
      return element;
    }
    case "code": {
      const pre = dom.createElement("pre");
      const code = dom.createElement("code");
      if (block.lang) code.setAttribute("data-lang", block.lang);
      code.appendChild(dom.createTextNode(block.text));
      pre.appendChild(code);
      return pre;
    }
    case "blockquote": {
      const element = dom.createElement("blockquote");
      appendBlocks(dom, element, block.blocks);
      return element;
    }
    case "rule":
      return dom.createElement("hr");
    case "list":
      return renderList(dom, block);
    case "table":
      return renderTable(dom, block);
  }
}

function renderList(dom: DomLike, block: Extract<Block, { type: "list" }>): ElementLike {
  const list = dom.createElement(block.ordered ? "ol" : "ul");
  if (block.ordered && block.start !== 1) list.setAttribute("start", String(block.start));

  const isTaskList = block.items.some((item) => item.checked !== null);
  if (isTaskList) list.setAttribute("class", "task-list");

  for (const item of block.items) {
    const li = dom.createElement("li");

    if (item.checked !== null) {
      const box = dom.createElement("input");
      box.setAttribute("type", "checkbox");
      box.setAttribute("disabled", "");
      // The reader does not edit documents, so the state is presentational.
      if (item.checked) box.setAttribute("checked", "");
      box.setAttribute("aria-label", item.checked ? "Completed" : "Not completed");
      li.appendChild(box);
    }

    // In a tight list the item text sits directly in the <li>; a loose list
    // keeps its paragraphs, which is what gives it the extra spacing.
    if (block.tight) {
      for (const child of item.blocks) {
        if (child.type === "paragraph") appendInline(dom, li, child.inline);
        else li.appendChild(renderBlock(dom, child));
      }
    } else {
      appendBlocks(dom, li, item.blocks);
    }

    list.appendChild(li);
  }

  return list;
}

function renderTable(dom: DomLike, block: Extract<Block, { type: "table" }>): ElementLike {
  // Wide tables scroll inside their own container rather than breaking the page.
  const wrapper = dom.createElement("div");
  wrapper.setAttribute("class", "table-scroll");

  const table = dom.createElement("table");
  const thead = dom.createElement("thead");
  const headRow = dom.createElement("tr");

  block.header.forEach((cell, column) => {
    const th = dom.createElement("th");
    applyAlign(th, block.align[column]);
    appendInline(dom, th, cell);
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = dom.createElement("tbody");
  for (const row of block.rows) {
    const tr = dom.createElement("tr");
    row.forEach((cell, column) => {
      const td = dom.createElement("td");
      applyAlign(td, block.align[column]);
      appendInline(dom, td, cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrapper.appendChild(table);
  return wrapper;
}

/**
 * Alignment is a class rather than a `style` attribute so that the deployed
 * Content-Security-Policy can forbid inline styles outright.
 */
function applyAlign(cell: ElementLike, align: string | null): void {
  if (align) cell.setAttribute("class", `align-${align}`);
}

function appendInline(dom: DomLike, parent: ElementLike, nodes: InlineNode[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        parent.appendChild(dom.createTextNode(node.value));
        break;
      case "break":
        parent.appendChild(dom.createElement("br"));
        break;
      case "codespan": {
        const code = dom.createElement("code");
        code.appendChild(dom.createTextNode(node.value));
        parent.appendChild(code);
        break;
      }
      case "emphasis":
      case "strong":
      case "strike": {
        const tag = node.type === "emphasis" ? "em" : node.type === "strong" ? "strong" : "del";
        const element = dom.createElement(tag);
        appendInline(dom, element, node.children);
        parent.appendChild(element);
        break;
      }
      case "image": {
        const image = dom.createElement("img");
        image.setAttribute("src", node.src);
        image.setAttribute("alt", node.alt);
        image.setAttribute("loading", "lazy");
        if (node.title) image.setAttribute("title", node.title);
        parent.appendChild(image);
        break;
      }
      case "link": {
        const anchor = dom.createElement("a");
        anchor.setAttribute("href", node.href);
        if (node.title) anchor.setAttribute("title", node.title);
        if (isExternal(node.href)) {
          anchor.setAttribute("target", "_blank");
          anchor.setAttribute("rel", "noopener noreferrer");
        }
        appendInline(dom, anchor, node.children);
        parent.appendChild(anchor);
        break;
      }
    }
  }
}
