/**
 * The contract between the service worker and the page for a shared file.
 *
 * Both sides import this so the cache key, form field and flag cannot drift
 * apart. Paths are relative and resolved against the service worker scope,
 * which keeps the application host- and subpath-agnostic.
 */

export const SHARE_CACHE = "shared-document";
export const SHARE_ENTRY_PATH = "__shared-document";
export const SHARE_ACTION_PATH = "share-target";
/** Must match the `params.files[].name` in the manifest. */
export const SHARE_FIELD = "file";
export const SHARE_FLAG = "shared";
export const SHARE_NAME_HEADER = "x-document-name";

export function resolvePath(path: string, base: string): string {
  return new URL(path, base).href;
}
