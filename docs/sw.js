// 電波が弱いときも前回の画面を開けるようにするための仕組み（まずネット、だめなら保存済み）
const CACHE = "salon-v3";
const SHELL = ["./", "index.html", "style.css", "app.js", "report.js", "keywords.js", "ai.js", "icon-180.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 同じサイトの GET だけ扱う（AI とのやりとりや外部の部品はそのまま通す）
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  url.search = "";
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(url.toString(), copy));
      return res;
    }).catch(() => caches.match(url.toString()))
  );
});
