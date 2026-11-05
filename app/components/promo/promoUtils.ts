// app/components/promo/promoUtils.ts
// ── BARU (pemecahan PromoModule.tsx) ── Helper tampilan murni (tanpa React)
// yang sebelumnya ada di atas PromoModule.tsx — dipakai bersama oleh
// ScreenMediaManager, PromoModule, ScreenFormModal, dst.

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tanggal lengkap untuk atribut `title` (tooltip saat hover), mis. "12 Mar 2026". */
export function formatScreenDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Waktu relatif ringkas untuk kartu TV, mis. "5 hari lalu". */
export function relativeScreenTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  if (diffDays <= 0) return "Hari ini";
  if (diffDays === 1) return "Kemarin";
  if (diffDays < 7) return `${diffDays} hari lalu`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} minggu lalu`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} bulan lalu`;
  return `${Math.floor(diffDays / 365)} tahun lalu`;
}

export const LABEL_CLASS =
  "mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
