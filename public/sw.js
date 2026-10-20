// =====================================================================
// Service Worker: סקריפט שהדפדפן מריץ ברקע, בין האתר לבין הרשת.
// כל בקשה של האתר (לדף, ל-CSS, ל-JS) עוברת דרכו, והוא מחליט מאיפה לענות.
//
// האסטרטגיה שלנו: "קודם רשת" (network first).
// - יש אינטרנט: מביאים את הגרסה העדכנית מהשרת, ושומרים עותק במטמון (cache).
// - אין אינטרנט: עונים מהעותק השמור, וכך האתר נפתח גם בלי רשת.
// היתרון: אחרי deploy ליאור מקבלת מיד את הגרסה החדשה, ולא גרסה ישנה מהמטמון.
// =====================================================================

const CACHE_NAME = "calorie-tracker-v1";

// הקבצים שהאתר צריך כדי לעלות. שומרים אותם כבר בהתקנה, כדי שיעבוד אופליין מהרגע הראשון.
const APP_FILES = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png"];

// התקנה: רצה פעם אחת כשהדפדפן מוריד Service Worker חדש
self.addEventListener("install", (event) => {
  // waitUntil אומר לדפדפן "אל תסיים את ההתקנה עד שההבטחה (Promise) הזו תיגמר"
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  // מפעילים את הגרסה החדשה מיד, בלי לחכות שכל הלשוניות הישנות ייסגרו
  self.skipWaiting();
});

// הפעלה: מוחקים מטמונים של גרסאות קודמות (אם נשנה את CACHE_NAME בעתיד)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // לא נוגעים בבקשות ל-AI (תשובה ישנה מהמטמון לא שווה כלום), בבקשות שאינן GET,
  // ובבקשות לאתרים אחרים. בלי respondWith, הדפדפן מטפל בהן כרגיל.
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // clone: אפשר לקרוא תשובה רק פעם אחת, אז שומרים עותק ומחזירים את המקור
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // אין רשת. אם זו פתיחה של דף, מחזירים את הדף הראשי השמור.
    const cached = await cache.match(request);
    return cached || (request.mode === "navigate" ? cache.match("/") : Response.error());
  }
}
