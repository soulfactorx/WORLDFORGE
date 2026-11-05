/*
 * WORLDFORGE 서비스 워커 — 설치형 웹앱과 오프라인 실행용.
 * - 페이지(HTML): 네트워크 우선, 안 되면 저장해 둔 것 (새 버전이 바로 반영되도록)
 * - 같은 출처의 정적 파일(JS·CSS·아이콘): 저장해 둔 것 우선, 뒤에서 새로 받아 갱신
 * - 다른 출처(AI API 등)는 건드리지 않는다. API 키·대화 내용은 캐시하지 않는다.
 */
const CACHE = 'worldforge-v2'; // v2: 웹앱 설정(manifest)을 네트워크 우선으로 — 바뀐 설정(화면 방향 등)이 바로 반영되게
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 페이지와 웹앱 설정(manifest)은 네트워크 우선: 새 버전·새 설정이 바로 반영되도록
  if (req.mode === 'navigate' || url.pathname.endsWith('.webmanifest')) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? './index.html' : req, copy));
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html').then((r) => r || caches.match('./')) : caches.match(req))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    });
    return hit || net;
  }));
});
