/**
 * Application shell: buttons, states, and the single document-loading path.
 *
 *   file picker ─┐
 *                ├─> loadDocument() ─> parseMarkdown() ─> renderDocument()
 *   share target ┘
 *
 * The UI knows nothing about how Markdown is parsed, and the parser knows
 * nothing about the UI.
 */

import "./style.css";

import { DocumentError, type MarkdownDocument } from "./document/document.js";
import { pickDocument } from "./input/file-picker.js";
import { hasPendingShare, purgeParkedDocuments, takeSharedDocument } from "./input/share-target.js";
import { browserDom, parseMarkdown, renderDocument } from "./markdown/index.js";
import { registerServiceWorker } from "./pwa/register.js";

const APP_NAME = "Markdown Reader";
/** A heading is document-controlled, so it does not get to be a novel. */
const MAX_TITLE_LENGTH = 120;

const openButton = requireElement<HTMLButtonElement>("open-button");
const printButton = requireElement<HTMLButtonElement>("print-button");
const filenameLabel = requireElement<HTMLElement>("filename");
const emptyState = requireElement<HTMLElement>("empty-state");
const errorBanner = requireElement<HTMLElement>("error");
const documentView = requireElement<HTMLElement>("document-view");

const dom = browserDom(document);

/** The loaded source is kept intact, ready for a future editor. */
let current: MarkdownDocument | null = null;

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

function loadDocument(doc: MarkdownDocument): void {
  const parsed = parseMarkdown(doc.source);
  const rendered = renderDocument(dom, parsed) as unknown as Node;

  documentView.replaceChildren(rendered);
  current = doc;

  filenameLabel.textContent = doc.name;
  document.title = `${(parsed.title ?? doc.name).slice(0, MAX_TITLE_LENGTH)} — ${APP_NAME}`;
  printButton.disabled = false;
  emptyState.hidden = true;
  documentView.hidden = false;
  showError(null);
  window.scrollTo(0, 0);
}

function showError(message: string | null): void {
  errorBanner.textContent = message ?? "";
  errorBanner.hidden = message === null;
}

/**
 * Turns any failure into a sentence a reader can act on. Unexpected errors
 * are logged for developers but never shown verbatim.
 */
function reportError(error: unknown): void {
  if (error instanceof DocumentError) {
    showError(error.message);
    return;
  }
  console.error(error);
  showError("Something went wrong opening that document. Please try again.");
}

async function openFile(): Promise<void> {
  openButton.disabled = true;
  try {
    const doc = await pickDocument();
    if (doc) loadDocument(doc);
  } catch (error) {
    reportError(error);
  } finally {
    openButton.disabled = false;
  }
}

openButton.addEventListener("click", () => {
  void openFile();
});

printButton.addEventListener("click", () => {
  if (current) window.print();
});

async function start(): Promise<void> {
  // A plain visit clears anything an earlier share left behind.
  if (!hasPendingShare()) {
    void purgeParkedDocuments();
  } else {
    try {
      const shared = await takeSharedDocument();
      if (shared) loadDocument(shared);
    } catch (error) {
      reportError(error);
    }
  }
  void registerServiceWorker();
}

void start();
