/**
 * A DOM stand-in for tests.
 *
 * The renderer builds nodes through a small interface rather than the global
 * `document`, so tests can supply this and compare the resulting markup
 * without a browser or a DOM emulation dependency.
 */

import type { DomLike, ElementLike } from "../src/markdown/renderer.js";

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

class FakeText {
  constructor(readonly value: string) {}
}

class FakeElement implements ElementLike {
  readonly children: unknown[] = [];
  readonly attributes: Array<[string, string]> = [];

  constructor(readonly tag: string) {}

  appendChild(child: unknown): unknown {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.push([name, value]);
  }
}

export const fakeDom: DomLike = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
};

/** Serialises a rendered tree so tests can assert on markup. */
export function html(node: unknown): string {
  if (node instanceof FakeText) return escapeText(node.value);
  if (!(node instanceof FakeElement)) return "";

  const attributes = node.attributes
    .map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`))
    .join("");

  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attributes}>`;

  const children = node.children.map(html).join("");
  return `<${node.tag}${attributes}>${children}</${node.tag}>`;
}

/** Every element tag produced by a rendered tree, in document order. */
export function tagsOf(node: unknown): string[] {
  if (!(node instanceof FakeElement)) return [];
  return [node.tag, ...node.children.flatMap(tagsOf)];
}

/** Every attribute produced by a rendered tree, as `[tag, name, value]`. */
export function attributesOf(node: unknown): Array<[string, string, string]> {
  if (!(node instanceof FakeElement)) return [];
  return [
    ...node.attributes.map(([name, value]) => [node.tag, name, value] as [string, string, string]),
    ...node.children.flatMap(attributesOf),
  ];
}

/** Mirrors what a browser does when text is inserted as a text node. */
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
