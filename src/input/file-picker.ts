/**
 * Opening a local file.
 *
 * Two mechanisms, one result. Desktop Chromium gets the File System Access
 * picker; Android Chrome does not implement it, so a hidden `<input type=file>`
 * is the fallback. Both restrict the choice to Markdown extensions, and the
 * file is read in the page — nothing is uploaded anywhere.
 */

import { documentFromFile, type MarkdownDocument } from "../document/document.js";

const ACCEPT = ".md,.markdown";

interface PickerWindow {
  showOpenFilePicker?: (options: unknown) => Promise<Array<{ getFile(): Promise<File> }>>;
}

/** Resolves with a document, or null when the user cancels. */
export async function pickDocument(): Promise<MarkdownDocument | null> {
  const file = await pickFile();
  return file === null ? null : documentFromFile(file);
}

async function pickFile(): Promise<File | null> {
  const picker = (window as unknown as PickerWindow).showOpenFilePicker;
  if (typeof picker === "function") {
    try {
      const [handle] = await picker.call(window, {
        multiple: false,
        types: [
          {
            description: "Markdown document",
            accept: { "text/markdown": [".md", ".markdown"] },
          },
        ],
      });
      return handle ? await handle.getFile() : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      // Any other failure (for example a blocked secure context) falls through
      // to the input element, which is available everywhere we support.
    }
  }
  return pickWithInput();
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.hidden = true;

    const finish = (file: File | null): void => {
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}
