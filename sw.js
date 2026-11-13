const CACHE = 'sugu-shell-v3';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('sugu-shell-') && k !== CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('mimi-sync-db', 2);

    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('notes')) {
        d.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('syncMeta')) {
        d.createObjectStore('syncMeta', { keyPath: 'key' });
      }
    };

    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('Database blocked'));
  });
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const title = String(form.get('title') || '');
    const text = String(form.get('text') || '');
    const url = String(form.get('url') || '');

    const body = [text, url]
      .filter((x, i, a) => x && a.indexOf(x) === i)
      .join('\n');

    if (!title && !body) {
      return Response.redirect(
        new URL('./index.html', self.registration.scope).href,
        303
      );
    }

    const now = new Date().toISOString();

    const note = {
      id: crypto.randomUUID(),
      title,
      body,
      ear: false,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      deleted: false
    };

    const db = await openDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').put(note);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    db.close();

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const c of clients) {
      c.postMessage({
        type: 'SUGU_SHARED',
        id: note.id
      });
    }

    // 共有された本文はURLに含めない。
    return Response.redirect(
      new URL('./index.html?shared=1', self.registration.scope).href,
      303
    );
  } catch (e) {
    return new Response(
      '共有メモを保存できませんでした。SUGUを開いて保存領域を確認してください。',
      {
        status: 500,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      }
    );
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith(receiveShare(request));
    return;
  }

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE).then(c =>
                c.put('./index.html', copy)
              )
            );
          }
          return response;
        })
        .catch(async () =>
          (await caches.match('./index.html')) || Response.error()
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
