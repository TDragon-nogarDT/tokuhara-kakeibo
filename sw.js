// 徳原家家計管理アプリ — Service Worker
// 目的: 電波が届かない場所でもアプリを起動できるようにする（アプリシェルのキャッシュ）
//
// 注意: これはあくまで「アプリの外枠を開けるようにする」ためのものです。
// 家計データそのものはFirebase Realtime Databaseがオンライン時に同期しており、
// 完全なオフライン編集・後日同期までは保証しません（電波復帰後に再読み込みしてください）。

// APP_VERSIONと連動させるため、index.htmlの更新時にここも更新することで
// 古いキャッシュを確実に破棄できます。手動でバージョン文字列を変更してください。
const CACHE_VERSION = "v2026.07.22.2114";
const CACHE_NAME = `tokuhara-kakeibo-${CACHE_VERSION}`;

// このアプリは単一HTMLファイル構成のため、キャッシュ対象はルートパスのみ。
const APP_SHELL = ["./", "./index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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
  const { request } = event;

  // Firebase等の外部API通信はキャッシュ対象外（常にネットワークへ）
  if (
    !request.url.startsWith(self.location.origin) ||
    request.url.includes("firebaseio.com") ||
    request.url.includes("googleapis.com") ||
    request.url.includes("anthropic.com")
  ) {
    return;
  }

  // ナビゲーション（HTML取得）: ネットワーク優先、失敗時はキャッシュから復帰
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // その他の同一オリジンリクエスト: キャッシュ優先、なければネットワーク
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
