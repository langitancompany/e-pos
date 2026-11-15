// public/sw.js
// Service worker minimal agar aplikasi bisa dipasang (installable).
// SENGAJA tidak menyimpan cache apa pun dan tidak mencegat fetch: data kasir
// (stok, harga, shift, pembayaran) harus selalu segar dari server.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
