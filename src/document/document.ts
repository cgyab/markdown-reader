/**
 * The document representation shared by every input path.
 *
 * File picker and share target both call `documentFromFile`, so there is
 * exactly one place where a file becomes something the reader can render —
 * and, later, something an editor could modify. It is also the one place
 * where a filename is normalised and a size limit is enforced.
 */

export interface MarkdownDocument {
  /** Display name: a bare filename, already stripped of anything odd. */
  name: string;
  /** Untouched Markdown source. The renderer never mutates this. */
  source: string;
}

export const SUPPORTED_EXTENSIONS = [".md", ".markdown"] as const;

/**
 * Documents are read wholly into memory and parsed synchronously, so a very
 * large file would freeze the tab. Well past any hand-written document.
 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Errors carrying a message that is safe and useful to show to a user. */
export class DocumentError extends Error {}

/**
 * Reduces a platform-supplied name to a plain filename. Path segments are
 * dropped and control characters removed, so the name is safe to put in a
 * header, a title, or the UI regardless of what the sharing app sent.
 */
export function safeDisplayName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
}

export function isSupportedName(name: string): boolean {
  const lower = safeDisplayName(name).toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export async function documentFromFile(file: File): Promise<MarkdownDocument> {
  const name = safeDisplayName(file.name);

  if (!isSupportedName(name)) {
    throw new DocumentError(
      `“${name}” is not a Markdown file. Open a .md or .markdown file instead.`,
    );
  }

  if (typeof file.size === "number" && file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(
      `“${name}” is too large to open (the limit is ${Math.floor(
        MAX_DOCUMENT_BYTES / (1024 * 1024),
      )} MB).`,
    );
  }

  let source: string;
  try {
    source = await file.text();
  } catch {
    throw new DocumentError(`“${name}” could not be read. It may have been moved or deleted.`);
  }

  return { name, source };
}
