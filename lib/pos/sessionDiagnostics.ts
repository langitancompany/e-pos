// lib/pos/sessionDiagnostics.ts
// Ringkasan kondisi browser yang relevan untuk masalah "sesi login tidak
// ditemukan". HANYA berisi ya/tidak dan jumlah, tidak pernah nilai cookie
// atau token, jadi aman ditampilkan di layar dan difoto untuk dikirim.

export function collectSessionDiagnostics(): string {
  if (typeof window === "undefined") return "";
  const yn = (v: boolean) => (v ? "ya" : "tidak");

  let cookieNames: string[] = [];
  try {
    cookieNames = document.cookie
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean);
  } catch {
    // cookie tidak terbaca
  }
  const authCookies = cookieNames.filter((n) => /^sb-.*auth-token/.test(n));

  let storageOk = false;
  try {
    window.localStorage.setItem("__diag", "1");
    window.localStorage.removeItem("__diag");
    storageOk = true;
  } catch {
    // diblokir (mode privat / pengaturan browser)
  }

  const ua = navigator.userAgent;
  const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|; wv\)/i.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return [
    `alamat=${window.location.protocol}//${window.location.host}`,
    `koneksi aman=${yn(window.isSecureContext)}`,
    `cookie aktif=${yn(navigator.cookieEnabled)}`,
    `cookie login ditemukan=${authCookies.length > 0 ? `ya (${authCookies.length} bagian)` : "tidak"}`,
    `penyimpanan lokal=${yn(storageOk)}`,
    `browser dalam aplikasi=${yn(inApp)}`,
    `mode aplikasi terpasang=${yn(standalone)}`,
  ].join(", ");
}
