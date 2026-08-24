// Registered as a MODULE worker (see main.js's own
// registerServiceWorker(): navigator.serviceWorker.register(url, {
// type: 'module' })) specifically so this file can `import` the
// exact same Firebase SDK version and config object every other file
// in this app already uses, rather than duplicating those values
// here or pulling in a second, parallel "compat" SDK build nothing
// else in this app uses. This is an additive change on top of the
// existing cache-first PWA behavior below (install/activate/fetch) —
// none of that behavior is touched; module vs. classic script only
// changes how this file's own top-level code is parsed, not how any
// event listener runs.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getMessaging, onBackgroundMessage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-sw.js";
import { firebaseConfig } from "./js/config/firebaseConfig.js";

initializeApp(firebaseConfig);
const messaging = getMessaging();

// Phase 1 (this milestone): nothing anywhere in this app sends a push
// yet — see services/pushNotificationService.js's own header comment
// for why (no backend exists to call FCM's send API from). This
// handler exists so the client side is already correct and ready once
// a later phase adds that. Minimum required background-message
// handling: show a plain system notification from whatever payload
// eventually arrives.
onBackgroundMessage(messaging, (payload) => {
  const title = payload.notification?.title || "ClassMate";
  const options = {
    body: payload.notification?.body || "",
    icon: "assets/icons/icon-192.png",
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

// Focuses an already-open ClassMate tab if one exists, rather than
// always opening a new one — standard, minimal notification-click
// handling; nothing here is specific to any one notification's own
// content yet (that's a later phase's concern, once real notifications
// carry a real destination).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

const CACHE_NAME = "classmate-v1.1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add("/"))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Same-origin only. Every Firebase call this app makes (Auth's
  // identitytoolkit/securetoken requests, Firestore's own real-time
  // WebChannel stream and writes, FCM) is cross-origin from this app's
  // own classmate-302c2.web.app origin, same as Google Fonts. Letting
  // any of those fall through to this handler's cache-then-network
  // logic below risks serving a stale cached Auth/Firestore response
  // instead of live data, or wrapping a long-lived real-time stream in
  // logic this handler was never designed for. Leaving them
  // unintercepted (no respondWith() at all — the browser handles the
  // request exactly as if no service worker existed) is what actually
  // guarantees Firebase Auth, Firestore reads/writes, and real-time
  // listeners can't be affected by this file at all. Only this app's
  // own static shell (HTML/CSS/JS/manifest/icons, all served from this
  // same origin) is ever cached below.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});