// lib/pos/dateRange.ts
// ── Util tanggal & rentang laporan (MURNI — tanpa React/Supabase) ──────────
// Dipindahkan dari hooks/useDashboard.ts dan hooks/useReports.ts, yang dulu
// masing-masing punya salinan sendiri. Perilakunya tidak diubah.
//
// Semua fungsi memakai waktu LOKAL, bukan UTC. `new Date().toISOString()
// .slice(0, 10)` SALAH untuk kita: WIB (UTC+7) membuat transaksi jam
// 00:00–07:00 masuk ke tanggal kemarin versi UTC.

export type ReportDatePreset =
  | "today"
  | "7d"
  | "30d"
  | "this_month"
  | "last_month"
  | "custom";

export interface DateRange {
  start: Date;
  end: Date;
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Kunci tanggal lokal `YYYY-MM-DD` untuk pengelompokan. */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Label pendek untuk sumbu X, mis. "17 Sep". */
export function shortLabel(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
  }).format(date);
}

/** Memecah array jadi potongan berukuran `size` (PostgREST membatasi panjang URL `.in()`). */
export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Preset → rentang tanggal. `now` bisa disuntik supaya mudah dites; bawaannya
 * jam saat ini (perilaku lama).
 */
export function presetToRange(
  preset: ReportDatePreset,
  customRange?: DateRange,
  now: Date = new Date(),
): DateRange {
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { start: today, end: endOfDay(now) };
    case "7d":
      return { start: addDays(today, -6), end: endOfDay(now) };
    case "30d":
      return { start: addDays(today, -29), end: endOfDay(now) };
    case "this_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: endOfDay(now),
      };
    case "last_month": {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: startOfDay(lastMonthStart), end: endOfDay(lastMonthEnd) };
    }
    case "custom":
      if (!customRange) {
        throw new Error("customRange wajib diisi untuk preset 'custom'.");
      }
      return {
        start: startOfDay(customRange.start),
        end: endOfDay(customRange.end),
      };
    default:
      return { start: today, end: endOfDay(now) };
  }
}
