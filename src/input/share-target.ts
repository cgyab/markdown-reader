/**
 * Android share target.
 *
 * A share is an HTTP POST, which is not something a single-page application
 * can read from `location`. The service worker intercepts the POST, parses the
 * multipart body, parks the file in the Cache API, and redirects the browser to
 * a normal GET URL carrying only a short status flag. This module collects the
 * parked file and hands it to the same loader the file picker uses.
 *
 * The redirect (a 303) is what stops a refresh or a back navigation from
 * resubmitting the document; the flag is then removed from the URL as well.
 */

import { DocumentError, documentFromFile, type MarkdownDocument } from "../document/document.js";
import {
  SHARE_CACHE,
  SHARE_ENTRY_PATH,
  SHARE_FLAG,
  SHARE_NAME_HEADER,
  resolvePath,
} from "../pwa/share-protocol.js";


/**
 * Values the flag may carry. The first three come from the service worker;
 * `unavailable` comes from the server, when a share POST reached Apache
 * because no service worker was there to intercept it.
 */
export type ShareStatus = "ok" | "unsupported" | "empty" | "unavailable";

export function hasPendingShare(url: URL = new URL(window.location.href)): boolean {
  return url.searchParams.has(SHARE_FLAG);
}

/**
 * Retrieves the shared document exactly once. Returns null when there is
 * nothing to collect, and throws a DocumentError when the share was unusable.
 */
export async function takeSharedDocument(): Promise<MarkdownDocument | null> {
  const url = new URL(window.location.href);
  const status = url.searchParams.get(SHARE_FLAG) as ShareStatus | null;
  if (status === null) return null;
  clearShareFlag(url);

  if (status === "unsupported") {
    throw new DocumentError("That file is not a Markdown document. Share a .md or .markdown file.");
  }
  if (status === "empty") {
    throw new DocumentError("That share did not contain a file.");
  }
  if (status === "unavailable") {
    throw new DocumentError(
      "Sharing is not ready yet. Open Markdown Reader once, then share the file again.",
    );
  }

  const parked = "caches" in window ? await readParkedDocument() : null;
  if (parked === null) {
    throw new DocumentError("The shared document could not be opened. Try sharing it again.");
  }
  return parked;
}

async function readParkedDocument(): Promise<MarkdownDocument | null> {
  const cache = await caches.open(SHARE_CACHE);
  const response = await cache.match(resolvePath(SHARE_ENTRY_PATH, window.location.href));
  if (!response) return null;
  await cache.delete(resolvePath(SHARE_ENTRY_PATH, window.location.href));

  const name = response.headers.get(SHARE_NAME_HEADER) || "shared.md";
  const blob = await response.blob();
  return documentFromFile(new File([blob], name, { type: "text/markdown" }));
}

/**
 * Removes any document left parked by an earlier share.
 *
 * The reader deletes the entry as it collects it, but a share that was never
 * opened — the user dismissed the app, or it was closed mid-launch — would
 * otherwise leave that document sitting in the Cache API indefinitely. Local
 * data should not outlive the moment it was needed.
 */
export async function purgeParkedDocuments(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    await caches.delete(SHARE_CACHE);
  } catch {
    // Storage unavailable (private mode, quota). Nothing to clean up.
  }
}

/** Replaces the share URL with the plain application URL. */
function clearShareFlag(url: URL): void {
  url.searchParams.delete(SHARE_FLAG);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
