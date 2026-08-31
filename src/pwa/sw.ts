/// <reference lib="webworker" />

/**
 * Service worker: application shell cache and Android share-target endpoint.
 *
 * Cache strategy is deliberately plain. Files whose names carry a content hash
 * are served cache-first; the two entry points the server marks `no-cache` —
 * the page itself and the manifest — are served network-first with the cache
 * as a fallback, so a deploy is picked up on the next load instead of the one
 * after it.
 *
 * The manifest matters more than it looks: Chrome reads it to build and update
 * the Android WebAPK. Serving a stale one cache-first means an install can be
 * minted from a manifest several deploys old, with the old icons and the old
 * share target, which no amount of cache-busting in it can fix.
 *
 * Cross-origin requests (images a document links to) are left to the network,
 * so they simply fail when offline while the application keeps working.
 */

import { MAX_DOCUMENT_BYTES, isSupportedName, safeDisplayName } from "../document/document.js";
import {
  SHARE_ACTION_PATH,
  SHARE_CACHE,
  SHARE_ENTRY_PATH,
  SHARE_FIELD,
  SHARE_FLAG,
  SHARE_NAME_HEADER,
  resolvePath,
} from "./share-protocol.js";

declare const self: ServiceWorkerGlobalScope;
/** Injected at build time: the files that make up the application shell. */
declare const __PRECACHE__: string[];
/** Injected at build time: changes whenever the shell changes. */
declare const __VERSION__: string;

const SHELL_CACHE = `app-shell-${__VERSION__}`;

/** How long a launch waits for the network before falling back to the cache. */
const NETWORK_TIMEOUT = 2500;

const scope = (): string => self.registration.scope;
const shellUrl = (): string => resolvePath("index.html", scope());
const manifestUrl = (): string => resolvePath("manifest.webmanifest", scope());
const shareAction = (): string => resolvePath(SHARE_ACTION_PATH, scope());
const shareEntry = (): string => resolvePath(SHARE_ENTRY_PATH, scope());
const appUrl = (flag?: string): string =>
  resolvePath(flag === undefined ? "./" : `./?${SHARE_FLAG}=${flag}`, scope());

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `cache: "reload"` bypasses the HTTP cache for these fetches. Without
      // it a file the browser still holds — an icon, whose filename never
      // changes — could be copied straight into a fresh shell cache and go on
      // being served long after it was replaced.
      const urls = __PRECACHE__.map(
        (path) => new Request(resolvePath(path, scope()), { cache: "reload" }),
      );

      try {
        await cache.addAll(urls);
      } catch {
        // `addAll` is all-or-nothing: one unfetchable URL rejects it, the
        // install fails, and the site is left with no active worker — so no
        // share target and no offline support either. A partial cache is far
        // better than none, so fall back to caching what can be cached.
        await Promise.all(
          urls.map(async (url) => {
            try {
              await cache.add(url);
            } catch {
              // Skipped: this file will be fetched from the network instead.
            }
          }),
        );
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== SHARE_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && url.href.split("?")[0] === shareAction()) {
    event.respondWith(receiveShare(request));
    return;
  }

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return; // external images, links
  if (url.href === shareEntry()) return; // internal parking slot, never served

  if (request.mode === "navigate") {
    event.respondWith(freshOrCached(shellUrl()));
    return;
  }

  if (url.href.split("?")[0] === manifestUrl()) {
    event.respondWith(freshOrCached(manifestUrl()));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/**
 * Handles the share POST: park the file, then redirect to a GET URL so that
 * reloading the reader never resubmits the share.
 */
async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const shared = form.get(SHARE_FIELD);

    if (!(shared instanceof File) || shared.size === 0) {
      return Response.redirect(appUrl("empty"), 303);
    }
    if (!isSupportedName(shared.name) || shared.size > MAX_DOCUMENT_BYTES) {
      return Response.redirect(appUrl("unsupported"), 303);
    }

    // The name is normalised here as well as in the loader: it is about to be
    // written into a response header, and a shared name is attacker-controlled.
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      shareEntry(),
      new Response(shared, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          [SHARE_NAME_HEADER]: safeDisplayName(shared.name),
        },
      }),
    );
    return Response.redirect(appUrl("ok"), 303);
  } catch {
    // A malformed multipart body lands here; the reader shows a plain message.
    return Response.redirect(appUrl("empty"), 303);
  }
}

/**
 * Network-first with a cache fallback, for the page and the manifest.
 *
 * Every navigation renders the same shell — the reader has no server routes —
 * so a navigation is answered with index.html whatever its URL was.
 */
async function freshOrCached(url: string): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await withTimeout(fetch(url, { cache: "no-cache" }), NETWORK_TIMEOUT);
    if (response.ok && response.type === "basic") {
      await cache.put(url, response.clone());
      return response;
    }
  } catch {
    // Offline, or the network took longer than a launch should wait.
  }

  const cached = await cache.match(url);
  if (cached) return cached;

  return new Response("Markdown Reader is offline and has not been installed yet.", {
    status: 503,
    headers: { "content-type": "text/plain" },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Only the application's own files are added at runtime. Without the scope
  // test, a document linking to same-origin URLs could grow the shell cache
  // with things that are not part of the application.
  if (response.ok && response.type === "basic" && request.url.startsWith(scope())) {
    await cache.put(request, response.clone());
  }
  return response;
}
