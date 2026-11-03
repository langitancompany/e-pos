// hooks/useReturnsReport.ts
// ── TAMBAHAN (Laporan, adopsi ide dari tab "Retur" Kula POS) ──
// Data tab "Retur" di LaporanModule.tsx: transaksi berstatus RETURN dalam
// rentang tanggal, lengkap dengan nomor struk asal dan nama kasir.
//
// - Struk asal & nama kasir diambil lewat query terpisah (bukan embed
//   PostgREST), sama seperti hooks/useReports.ts, karena bentuk FK tidak
//   seragam antara scripts/setup-database.sql dan rantai migration.
// - Kegagalan memuat nama kasir / struk asal TIDAK menggagalkan laporan:
//   kolomnya jadi "-".
// - Query baru jalan kalau `enabled` true (tab sedang dibuka).

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DateRange } from "@/hooks/useReports";
import { chunkArray, fetchAllPages, ID_CHUNK_SIZE } from "@/lib/pos/paginate";
import {
  buildReturnsReport,
  type ReturnTrxLite,
  type ReturnsReport,
} from "@/lib/pos/reportTraffic";

const supabase = createClient();

export interface UseReturnsReportResult {
  data: ReturnsReport | null;
  isLoading: boolean;
  error: string | null;
}

export function useReturnsReport(
  dateRange: DateRange,
  options: { enabled?: boolean } = {},
): UseReturnsReportResult {
  const enabled = options.enabled ?? true;
  const startMs = dateRange.start.getTime();
  const endMs = dateRange.end.getTime();

  const [data, setData] = useState<ReturnsReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const returns = await fetchAllPages<ReturnTrxLite>((from, to) =>
          supabase
            .from("transactions")
            .select(
              "id, receipt_no, total, created_at, cashier_id, void_reason, related_transaction_id",
            )
            .eq("status", "RETURN")
            .is("deleted_at", null)
            .gte("created_at", new Date(startMs).toISOString())
            .lte("created_at", new Date(endMs).toISOString())
            .order("created_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to),
        );

        const originalReceipts = new Map<string, string>();
        const cashierNames = new Map<string, string | null>();

        const originalIds = Array.from(
          new Set(
            returns
              .map((r) => r.related_transaction_id)
              .filter((id): id is string => id !== null),
          ),
        );
        const cashierIds = Array.from(
          new Set(returns.map((r) => r.cashier_id).filter((id): id is string => id !== null)),
        );

        try {
          for (const ids of chunkArray(originalIds, ID_CHUNK_SIZE)) {
            const { data: rows, error: rowError } = await supabase
              .from("transactions")
              .select("id, receipt_no")
              .in("id", ids);
            if (rowError) throw new Error(rowError.message);
            for (const row of rows ?? []) originalReceipts.set(row.id, row.receipt_no);
          }
          for (const ids of chunkArray(cashierIds, ID_CHUNK_SIZE)) {
            const { data: rows, error: rowError } = await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", ids);
            if (rowError) throw new Error(rowError.message);
            for (const row of rows ?? []) cashierNames.set(row.id, row.full_name ?? null);
          }
        } catch (lookupError) {
          // Pelengkap saja: laporan tetap tampil, kolom terkait kosong.
          console.error("Gagal memuat struk asal / nama kasir untuk laporan retur:", lookupError);
        }

        if (isCancelled) return;
        setData(buildReturnsReport(returns, originalReceipts, cashierNames));
      } catch (err) {
        if (isCancelled) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Gagal memuat laporan retur.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [enabled, startMs, endMs]);

  return { data, isLoading, error };
}