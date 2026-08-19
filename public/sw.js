// Service worker for Første mann til mølla.
// Nå: cache app-shell for raskere oppstart og offline-grunnfjell.
// Fremtidig: push-event handler for varsler når appen er i bakgrunnen.

const CACHE_NAME = "fmtm-v1";
const APP_SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {
      // Ignorer hvis ressursene ikke er cached enda — vi cacher dynamisk senere.
    })),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Supabase-kall går alltid til nettverket.
  if (url.hostname.endsWith(".supabase.co")) return;
  // Cache-first for app-shell, nettverk-fallback for resten.
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached ?? fetched;
    }),
  );
});

// Plassholder for fremtidig push-varsling. Knytter seg på når
// Supabase Edge Function eller en egen push-tjeneste sender hit.
// self.addEventListener("push", (event) => {
//   const data = event.data?.json() ?? {};
//   self.registration.showNotification(data.title ?? "FMTM", {
//     body: data.body,
//     icon: "/icon-192.png",
//     badge: "/icon-192.png",
//     tag: data.tag ?? "fmtm",
//     data: data.url,
//   });
// });
//
// self.addEventListener("notificationclick", (event) => {
//   event.notification.close();
//   const target = event.notification.data ?? "/";
//   event.waitUntil(self.clients.openWindow(target));
// });
