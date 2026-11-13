'use strict';

const CACHE = 'sugu-shell-v4';

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
          .filter(key =>
            key.startsWith('sugu-shell-') && key !== CACHE
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mimi-sync-db', 2);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('syncMeta')) {
        db.createObjectStore('syncMeta', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('データベースが使用中です'));
  });
}

async function receiveShare(request) {
  let db;

  try {
    const form = await request.formData();

    const title = String(form.get('title') || '').trim();
    const text = String(form.get('text') || '');
    const url = String(form.get('url') || '');

    const parts = [];

    if (text) parts.push(text);
    if (url && !text.includes(url)) parts.push(url);

    const body = parts.join('\n');

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
      deleted: false
    };

    db = await openDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        ['notes', 'syncMeta'],
        'readwrite'
      );

      tx.objectStore('notes').add(note);

      tx.objectStore('syncMeta').put({
        key: 'sugu-pending-share',
        value: note.id
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    db.close();
    db = null;

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of windows) {
      client.postMessage({
        type: 'SUGU_SHARED',
        id: note.id
      });
    }

    return Response.redirect(
      new URL('./index.html?shared=1', self.registration.scope).href,
      303
    );

  } catch (error) {
    console.error('SUGU share:', error);

    if (db) db.close();

    return new Response(
      '共有メモを保存できませんでした。SUGUの保存領域を確認してください。',
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

  if (
    request.method === 'POST' &&
    url.pathname ===
      new URL('./share', self.registration.scope).pathname
  ) {
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
              caches.open(CACHE).then(cache =>
                cache.put('./index.html', copy)
              )
            );
          }

          return response;
        })
        .catch(async () => {
          return (
            await caches.match('./index.html')
          ) || Response.error();
        })
    );

    return;
  }

  event.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request)
    )
  );
});
