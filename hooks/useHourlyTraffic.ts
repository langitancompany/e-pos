// hooks/useHourlyTraffic.ts
// ── TAMBAHAN (Laporan, adopsi ide dari tab "Jam & Hari Ramai" Kula POS) ──
// Data tab "Jam & Hari Ramai" di LaporanModule.tsx untuk rentang tanggal yang
// sama dengan hooks/useReports.ts. Hanya membaca; hitungannya ada di
// lib/pos/reportTraffic.ts (fungsi murni).
//
// Query baru jalan kalau `enabled` true (tab sedang dibuka), supaya membuka
// Laporan tidak menarik data yang belum dilihat. Query dipaginasi (lihat
// lib/pos/paginate.ts).

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DateRange } from "@/hooks/useReports";
import { fetchAllPages } from "@/lib/pos/paginate";
import { buildTraffic, type SaleLite, type TrafficReport } from "@/lib/pos/reportTraffic";
import { useBranchScope } from "@/hooks/useActiveBranch";
import { branchFilter } from "@/lib/pos/branches";

const supabase = createClient();

export interface UseHourlyTrafficResult {
  data: TrafficReport | null;
  isLoading: boolean;
  error: string | null;
}

export function useHourlyTraffic(
  dateRange: DateRange,
  options: { enabled?: boolean } = {},
): UseHourlyTrafficResult {
  const enabled = options.enabled ?? true;
  const startMs = dateRange.start.getTime();
  const endMs = dateRange.end.getTime();

  const [data, setData] = useState<TrafficReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── TAMBAHAN (migration 047) ── Lalu lintas jam untuk cabang terpilih.
  const { branchId, ready } = useBranchScope();

  useEffect(() => {
    if (!enabled || !ready) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const sales = await fetchAllPages<SaleLite>((from, to) =>
          supabase
            .from("transactions")
            .select("id, total, created_at")
            .match(branchFilter(branchId))
            .eq("status", "PAID")
            .is("related_transaction_id", null)
            .is("deleted_at", null)
            .gte("created_at", new Date(startMs).toISOString())
            .lte("created_at", new Date(endMs).toISOString())
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        );
        if (isCancelled) return;
        setData(buildTraffic(sales));
      } catch (err) {
        if (isCancelled) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Gagal memuat data jam ramai.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [enabled, startMs, endMs, branchId, ready]);

  return { data, isLoading, error };
}