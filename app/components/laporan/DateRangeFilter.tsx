"use client";

// app/components/laporan/DateRangeFilter.tsx
// ── TAMBAHAN (rentang tanggal per tab Laporan) ──
// Filter rentang waktu yang dipasang DI DALAM tiap tab Laporan (bukan satu
// filter global di atas semua tab). State-nya dipegang LaporanModule lewat
// hooks/useReportDateRange.ts, satu instance per tab.
//
// Gaya mengikuti kartu filter di Riwayat Stok (StokRiwayatTab.tsx): kartu
// putih rounded-xl, input tanggal "Dari"/"Sampai", dan chip pintasan.
//
// Input tanggal selalu tampil (tidak ada tombol "Custom" + "Terapkan" lagi):
// begitu kedua tanggal valid dan urutannya benar, rentang langsung dipakai dan
// chip pintasan tidak ada yang menyala (artinya rentang kustom).

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { DateRange, ReportDatePreset } from "@/hooks/useReports";

const PRESETS: { key: Exclude<ReportDatePreset, "custom">; label: string }[] = [
  { key: "today", label: "Hari Ini" },
  { key: "7d", label: "7 Hari" },
  { key: "30d", label: "30 Hari" },
  { key: "this_month", label: "Bulan Ini" },
  { key: "last_month", label: "Bulan Lalu" },
];

// ── Util tanggal (waktu LOKAL — jangan `new Date("YYYY-MM-DD")`, itu diparse
//    sebagai UTC tengah malam dan bisa mundur 1 hari di WIB). ────────────────

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** Label rentang untuk tampilan, judul PDF, dan sel Excel, mis. "1 Sep 2026 — 18 Sep 2026". */
export function formatRangeLabel(range: DateRange): string {
  const formatter = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });
  return `${formatter.format(range.start)} — ${formatter.format(range.end)}`;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition-colors duration-150 focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950";

export function DateRangeFilter({
  preset,
  dateRange,
  onChange,
}: {
  preset: ReportDatePreset;
  dateRange: DateRange;
  onChange: (preset: ReportDatePreset, customRange?: DateRange) => void;
}) {
  const rangeKey = `${dateRange.start.getTime()}-${dateRange.end.getTime()}`;
  const [draftStart, setDraftStart] = useState(toDateInputValue(dateRange.start));
  const [draftEnd, setDraftEnd] = useState(toDateInputValue(dateRange.end));
  const [error, setError] = useState<string | null>(null);

  // Sinkronkan isian dengan rentang aktif saat berubah dari luar (klik chip
  // pintasan). Pola "sesuaikan state saat render" yang dianjurkan React, bukan
  // useEffect + setState.
  const [syncedKey, setSyncedKey] = useState(rangeKey);
  if (rangeKey !== syncedKey) {
    setSyncedKey(rangeKey);
    setDraftStart(toDateInputValue(dateRange.start));
    setDraftEnd(toDateInputValue(dateRange.end));
    setError(null);
  }

  const applyDraft = (nextStart: string, nextEnd: string) => {
    const start = parseDateInputValue(nextStart);
    const end = parseDateInputValue(nextEnd);

    if (!start || !end) {
      setError("Isi tanggal awal dan akhir.");
      return;
    }
    if (start > end) {
      setError("Tanggal awal tidak boleh setelah tanggal akhir.");
      return;
    }
    setError(null);
    onChange("custom", { start, end });
  };

  const handleStart = (value: string) => {
    setDraftStart(value);
    applyDraft(value, draftEnd);
  };

  const handleEnd = (value: string) => {
    setDraftEnd(value);
    applyDraft(draftStart, value);
  };

  return (
    <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        <CalendarDays className="h-3.5 w-3.5" />
        Rentang Waktu
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-md">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Dari tanggal
          </label>
          <input
            type="date"
            value={draftStart}
            max={draftEnd || undefined}
            onChange={(e) => handleStart(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Sampai tanggal
          </label>
          <input
            type="date"
            value={draftEnd}
            min={draftStart || undefined}
            onChange={(e) => handleEnd(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
              preset === p.key
                ? "border-lco-teal text-lco-teal"
                : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-lco-coral">{error}</p>}
    </div>
  );
}
