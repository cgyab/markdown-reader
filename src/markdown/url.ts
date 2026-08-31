/**
 * URL safety boundary.
 *
 * Small on purpose: this is not a sanitisation framework. The rule is that a
 * URL coming from a document may only reach the DOM if it is relative or uses
 * a scheme we explicitly trust. Everything else is dropped, which leaves the
 * link as plain text rather than a live `javascript:` navigation.
 */

/** Matches a leading URL scheme, e.g. `https:` or `javascript:`. */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/** Image data URLs we accept. SVG is excluded: it is an active document type. */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp|avif);/i;

/**
 * Whitespace and control characters are stripped before the scheme test,
 * because browsers ignore them inside a scheme: `java\nscript:alert(1)`
 * navigates just fine.
 */
function normalise(raw: string): string {
  return raw.replace(/[\u0000-\u0020\u007f]/g, "");
}

export function safeLinkUrl(raw: string): string | null {
  const url = normalise(raw);
  if (url === "") return null;
  const scheme = SCHEME.exec(url);
  if (!scheme) return url; // relative path, query or fragment
  return SAFE_SCHEMES.has(scheme[1].toLowerCase()) ? url : null;
}

export function safeImageUrl(raw: string): string | null {
  const url = normalise(raw);
  if (url === "") return null;
  if (SAFE_DATA_IMAGE.test(url)) return url;
  return safeLinkUrl(url);
}

/** True for links that leave the application and so need `rel` hardening. */
export function isExternal(url: string): boolean {
  const scheme = SCHEME.exec(url);
  return scheme !== null && /^https?$/i.test(scheme[1]);
}
