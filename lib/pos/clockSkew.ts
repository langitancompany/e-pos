// lib/pos/clockSkew.ts
// Mengukur selisih jam perangkat terhadap jam server lewat header `Date` dari
// /api/health. Jam perangkat yang meleset (tanggal/zona waktu salah) membuat
// masa berlaku token login terbaca keliru: server menganggap sesi kedaluwarsa
// dan melempar ke /login, sementara aplikasi di perangkat menunggu tanpa akhir.

export const CLOCK_SKEW_LIMIT_MS = 2 * 60 * 1000;

/** Selisih (jam perangkat - jam server) dalam ms, atau null kalau tak terukur. */
export async function measureClockSkewMs(): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const sentAt = Date.now();
    const res = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const receivedAt = Date.now();
    const header = res.headers.get("date");
    if (!header) return null;
    const serverTime = new Date(header).getTime();
    if (!Number.isFinite(serverTime)) return null;
    // Bandingkan dengan titik tengah perjalanan permintaan.
    return Math.round((sentAt + receivedAt) / 2 - serverTime);
  } catch {
    return null;
  }
}

/** Pesan siap tampil bila jam perangkat meleset jauh, selain itu null. */
export function describeClockSkew(skewMs: number | null): string | null {
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_LIMIT_MS) return null;
  const minutes = Math.round(Math.abs(skewMs) / 60000);
  const label =
    minutes >= 120
      ? `${Math.round(minutes / 60)} jam`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)} jam ${minutes % 60} menit`
        : `${minutes} menit`;
  return `Jam perangkat ini ${skewMs > 0 ? "lebih cepat" : "lebih lambat"} ${label} dari server. Aktifkan "Tanggal & waktu otomatis" di pengaturan perangkat, lalu login ulang.`;
}
