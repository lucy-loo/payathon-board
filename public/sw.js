// Service Worker：让看板可安装、离线可打开。
// 缓存策略（改动后请把 VERSION +1，旧缓存会在 activate 时清掉）：
//   - 页面导航        网络优先（保证样式/结构更新立刻生效），离线回退到缓存的首页
//   - data/daily/*    URL 含日期、归档后不再变化 -> 缓存优先
//   - 其余同源请求    网络优先；失败才回退缓存（index.json / history.json 走这条，避免用旧数据冒充新数据）
const VERSION = 'v2';
const CACHE = `payathon-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './charts.js',
  './app.js',
  './manifest.json',
  './og.png',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// 写缓存失败（如配额不足、响应不可缓存）不应影响正常响应
async function put(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch {
    /* 忽略 */
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 只接管同源请求

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match('./index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.includes('/data/daily/')) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await put(request, response.clone());
        return response;
      } catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        throw new Error(`offline: ${url.pathname}`);
      }
    })(),
  );
});
