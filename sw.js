'use strict';

const CACHE = 'sugu-shell-v3';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

const DB = 'mimi-sync-db';
const TABLE = 'notes';
const META = 'syncMeta';

const iso = () => new Date().toISOString();

/*
 * アプリの基本ファイルをキャッシュする。
 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS)
    )
  );

  self.skipWaiting();
});

/*
 * 古いキャッシュを削除する。
 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith('sugu-shell-') &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/*
 * IndexedDBを開く。
 *
 * index.htmlと同じデータベースを使う。
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(TABLE)) {
        database.createObjectStore(
          TABLE,
          { keyPath: 'id' }
        );
      }

      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(
          META,
          { keyPath: 'key' }
        );
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };

    request.onblocked = () => {
      reject(new Error('保存領域が使用中です'));
    };
  });
}

/*
 * 共有された文章を端末内に保存する。
 */
async function saveSharedNote(title, body) {
  const database = await openDB();
  const now = iso();

  const note = {
    id: crypto.randomUUID(),
    title: title || '',
    body: body || '',
    ear: false,
    pinned: false,
    checklist: false,
    checks: [],
    createdAt: now,
    updatedAt: now,
    contentAt: now,
    deleted: false,
    deletedAt: ''
  };

  try {
    await new Promise((resolve, reject) => {
      const tx = database.transaction(
        [TABLE, META],
        'readwrite'
      );

      tx.objectStore(TABLE).put(note);

      tx.objectStore(META).put({
        key: 'sugu-pending-share',
        value: note.id
      });

      tx.oncomplete = () => resolve();

      tx.onerror = () => reject(
        tx.error || new Error('保存に失敗しました')
      );

      tx.onabort = () => reject(
        tx.error || new Error('保存が中断されました')
      );
    });

    return note.id;

  } finally {
    database.close();
  }
}

/*
 * Androidの共有メニューから受信する。
 *
 * manifest.webmanifest の
 * share_target.action = "./share"
 * に対応する処理。
 */
async function receiveShare(request) {
  const form = await request.formData();

  const title = String(
    form.get('title') || ''
  ).trim();

  const text = String(
    form.get('text') || ''
  ).trim();

  const url = String(
    form.get('url') || ''
  ).trim();

  const parts = [];

  if (text) {
    parts.push(text);
  }

  /*
   * Androidでは共有URLがtextに
   * 入っていることがある。
   *
   * 同じURLを二重に保存しない。
   */
  if (url && !parts.some(x => x.includes(url))) {
    parts.push(url);
  }

  const body = parts.join('\n\n');

  if (!title && !body) {
    return Response.redirect(
      new URL('./index.html', self.registration.scope).href,
      303
    );
  }

  await saveSharedNote(title, body);

  /*
   * 保存後にSUGUを開く。
   * index.htmlのreceivePendingShare()が
   * 新しいメモを開く。
   */
  const destination = new URL(
    './index.html',
    self.registration.scope
  );

  destination.searchParams.set('shared', '1');

  return Response.redirect(
    destination.href,
    303
  );
}

/*
 * 通信を処理する。
 */
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  /*
   * 共有用のPOSTを最優先で処理する。
   */
  const shareURL = new URL(
    './share',
    self.registration.scope
  );

  if (
    request.method === 'POST' &&
    url.pathname === shareURL.pathname
  ) {
    event.respondWith(
      receiveShare(request).catch(error => {
        console.error('SUGU share error:', error);

        return new Response(
          'SUGUで共有データを保存できませんでした。',
          {
            status: 500,
            headers: {
              'Content-Type':
                'text/plain; charset=utf-8'
            }
          }
        );
      })
    );

    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  /*
   * ページはオンライン時に最新版を優先する。
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();

            caches.open(CACHE).then(cache =>
              cache.put('./index.html', copy)
            ).catch(console.warn);
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

  /*
   * アイコンや静的ファイルはキャッシュを優先。
   */
  event.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request)
    )
  );
});
