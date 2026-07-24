/* Arenas service worker.
 *
 * POLICY: DEPLOY WINS. Every same-origin GET (navigations, CSS, JS, images)
 * is network-first with cache fallback — a deploy is visible on the next
 * load, no force-refresh ever needed. There is deliberately NO
 * stale-while-revalidate on HTML/CSS/JS: assets here are unfingerprinted, so
 * serving a stale script against fresh HTML risks a version mismatch.
 *
 * Cache-first is allowed ONLY where filenames are versioned:
 *   - Supabase storage avatars (timestamped filenames — safe to cache hard)
 *   - fonts.gstatic.com font binaries (content-hashed URLs)
 *
 * NEVER TOUCHED (the request never enters respondWith):
 *   - non-GET requests (all POST/PUT/DELETE, incl. the Stripe webhook)
 *   - same-origin /api/* and /auth/* (authenticated JSON + auth redirects
 *     stay network-only; /api/stripe/webhook is excluded twice over)
 *   - every other cross-origin request (Stripe checkout, Supabase API,
 *     fonts.googleapis.com CSS). Top-level navigations to other origins
 *     never reach this worker at all — interception is same-origin by
 *     construction, plus the two versioned-asset allowlists above.
 *
 * UPDATE DISCIPLINE: versioned cache names; skipWaiting on install;
 * clients.claim + old-cache purge on activate. Bump VERSION to invalidate
 * every runtime cache in one deploy.
 */
'use strict';

const VERSION = 'v2';
const RUNTIME_CACHE = 'arenas-runtime-' + VERSION;
const AVATAR_CACHE = 'arenas-avatars-' + VERSION;
const FONT_CACHE = 'arenas-fonts-' + VERSION;
const KNOWN_CACHES = [RUNTIME_CACHE, AVATAR_CACHE, FONT_CACHE];

// Base path of the app: '' on realarenas.com (Railway, scope "/"),
// '/html' on the Replit preview (scope "/html/"). Derived from where this
// worker was registered so the same file serves both environments.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const OFFLINE_URL = BASE + '/offline';

// Substituted by server.js at serve time with the Supabase project host
// (public information — it is in every avatar URL). If substitution fails
// the placeholder matches no hostname and avatars are simply left alone.
const SUPABASE_HOST = '__SUPABASE_HOST__';

// PRIVACY BOUNDARY: only these public, non-user-specific pages may be cached
// for offline navigation. Authenticated pages (/feed, /profile, club pages…)
// are server-rendered WITH the signed-in user's data baked into the HTML —
// caching them would let a later user of the same browser (after logout or
// account switch) be served someone else's page during an outage. App pages
// therefore fall back to the branded offline page instead of a cached copy.
const PUBLIC_PAGES = [
  '/landing', '/about', '/terms', '/privacy', '/for-clubs',
  '/how-points-work', '/offline'
];
function isPublicPage(pathname) {
  const rel = BASE && pathname.indexOf(BASE) === 0 ? pathname.slice(BASE.length) : pathname;
  return PUBLIC_PAGES.indexOf(rel || '/') !== -1;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(RUNTIME_CACHE);
      // cache:'reload' bypasses the HTTP cache so the fallback is current.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    } catch (err) {
      // A missing offline page must not block the worker (deploy-wins beats
      // offline polish); navigations then fail as they would without a SW.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.indexOf('arenas-') === 0 && KNOWN_CACHES.indexOf(n) === -1)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// Keep versioned-asset caches bounded (opaque responses carry quota padding).
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    // keys() is insertion-ordered; drop oldest first.
    for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
  } catch (err) { /* trim is best-effort */ }
}

// Network-first: fresh response wins and refreshes the cache. The cache is
// consulted only when the network truly fails: fetch threw (offline) or the
// edge proxy answered 502/503/504 because the app itself was unreachable
// (mid-deploy blip). App-level responses — 200s, redirects, 404s, 500s —
// always pass through untouched, so deploys and real errors stay honest.
async function networkFirst(request, isNavigation) {
  const cache = await caches.open(RUNTIME_CACHE);
  let response = null;
  try {
    response = await fetch(request);
  } catch (err) { /* true offline — fall through to cache */ }

  if (response) {
    // Only cache real same-origin 200s — and for navigations, only PUBLIC
    // pages (see PUBLIC_PAGES above; authenticated HTML must never be
    // replayable to a different user). Navigation redirects (302 → login)
    // surface here as opaqueredirect (status 0) and pass through uncached —
    // the browser follows them itself.
    if (response.ok && response.type === 'basic') {
      const cacheable = !isNavigation || isPublicPage(new URL(request.url).pathname);
      if (cacheable) cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    const gatewayFail =
      response.status === 502 || response.status === 503 || response.status === 504;
    if (!gatewayFail) return response;
  }

  const cached = await cache.match(request);
  if (cached) return cached;
  if (isNavigation) {
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
  }
  if (response) return response; // the gateway error itself, better than nothing
  throw new Error('offline: ' + request.url);
}

// Cache-first for versioned-filename assets only: a hit never goes to the
// network (the filename IS the version), a miss populates the cache.
async function cacheFirstVersioned(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // <img> fetches are no-cors → opaque (status 0); still safe to cache
  // because the filename is versioned.
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone()).catch(() => {});
    trimCache(cacheName, maxEntries); // fire and forget
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Rule 1: only GET is ever intercepted.
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (err) { return; }

  // Rule 2: cross-origin is untouched, except the two versioned-filename
  // hosts that are explicitly safe to cache hard.
  if (url.origin !== self.location.origin) {
    if (
      SUPABASE_HOST &&
      url.hostname === SUPABASE_HOST &&
      url.pathname.indexOf('/storage/v1/object/public/avatars/') === 0
    ) {
      event.respondWith(cacheFirstVersioned(request, AVATAR_CACHE, 80));
    } else if (url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cacheFirstVersioned(request, FONT_CACHE, 30));
    }
    return; // Stripe / Supabase API / fonts.googleapis.com: never intercepted
  }

  // Rule 3: same-origin /api/* and /auth/* are network-only. Checked against
  // both the scoped base and the bare prefix so no environment leaks through.
  const p = url.pathname;
  if (
    p.indexOf(BASE + '/api/') === 0 || p.indexOf(BASE + '/auth/') === 0 ||
    p.indexOf('/api/') === 0 || p.indexOf('/auth/') === 0
  ) return;

  // Rule 4: navigations — network-first, cache fallback, offline page last.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, true));
    return;
  }

  // Rule 5: same-origin assets — network-first, cache fallback.
  event.respondWith(networkFirst(request, false));
});
