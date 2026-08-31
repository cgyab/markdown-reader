/**
 * Service worker registration.
 *
 * Registration is best-effort: without it the reader still opens files, it
 * just loses offline support and the Android share target.
 */

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(new URL("sw.js", document.baseURI).href, {
      scope: "./",
    });
  } catch {
    // Insecure context, private mode, or a blocked worker. Nothing to do.
  }
}
