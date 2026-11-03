// hooks/useReportDateRange.ts
// ── TAMBAHAN (rentang tanggal per tab Laporan) ──
// State preset + rentang tanggal untuk SATU tab Laporan. LaporanModule.tsx
// memanggil hook ini sekali per tab yang punya filter tanggal (Harian/Bulanan,
// Jam & Hari Ramai, Retur, Per Shift), sehingga tiap tab punya rentang sendiri
// dan nilainya tetap tersimpan saat pindah tab (state hidup di modul induk,
// bukan di komponen tab yang di-unmount).

"use client";

import { useCallback, useState } from "react";
import {
  presetToRange,
  type DateRange,
  type ReportDatePreset,
} from "@/hooks/useReports";

export interface UseReportDateRangeResult {
  preset: ReportDatePreset;
  dateRange: DateRange;
  setPreset: (preset: ReportDatePreset, customRange?: DateRange) => void;
}

export function useReportDateRange(
  initialPreset: ReportDatePreset = "this_month",
): UseReportDateRangeResult {
  const [preset, setPresetState] = useState<ReportDatePreset>(initialPreset);
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    presetToRange(initialPreset),
  );

  const setPreset = useCallback(
    (next: ReportDatePreset, customRange?: DateRange) => {
      setPresetState(next);
      setDateRange(presetToRange(next, customRange));
    },
    [],
  );

  return { preset, dateRange, setPreset };
}
