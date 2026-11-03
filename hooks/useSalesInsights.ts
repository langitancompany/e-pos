// hooks/useSalesInsights.ts
// ── TAMBAHAN (Laporan, adopsi ide dari "Laporan Harian" Kula POS) ──────────
// Data tambahan untuk tab Harian/Bulanan di LaporanModule.tsx, untuk rentang
// tanggal yang SAMA dengan hooks/useReports.ts:
//   - ringkasan periode terpilih + periode pembanding (selisih persen di KPI)
//   - bauran metode pembayaran (tabel `payments`)
//   - produk terlaris (tabel `transaction_items`)
//   - kas keluar per kategori (tabel `cash_movements`, tanpa yang dibatalkan)
//
// Sengaja hook TERPISAH dari useReports.ts (yang sudah 549 baris) dan hanya
// membaca; semua hitungan ada di lib/pos/reportInsights.ts (fungsi murni).
//
// Beda dengan useReports.ts: query di sini DIPAGINASI (1000 baris per halaman).
// Supabase membatasi satu query sampai 1000 baris secara bawaan; tanpa
// paginasi, rentang ramai (mis. 30 hari) bisa terpotong diam-diam.
//
// Kegagalan memuat kas keluar TIDAK menggagalkan seluruh bagian: field
// `cashOutError` terisi dan bagian lain tetap tampil (kas keluar bisa saja
// dibatasi RLS untuk role tertentu).

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DateRange, SalesSummary } from "@/hooks/useReports";
import { CASH_CATEGORIES } from "@/hooks/useCashMovements";
import {
  buildCashOut,
  buildPaymentMix,
  buildTopProducts,
  previousRange,
  summarizeSales,
  type CashOutLite,
  type CashOutSummary,
  type PaymentLite,
  type PaymentMixRow,
  type SaleItemLite,
  type TopProductRow,
  type TransactionLite,
} from "@/lib/pos/reportInsights";

const supabase = createClient();

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 150;

export interface SalesInsightsData {
  currentSummary: SalesSummary;
  previousSummary: SalesSummary;
  previousRange: DateRange;
  paymentMix: PaymentMixRow[];
  topProducts: TopProductRow[];
  /** null = gagal dimuat (lihat `cashOutError`), BUKAN berarti tidak ada kas keluar. */
  cashOut: CashOutSummary | null;
}

export interface UseSalesInsightsResult {
  data: SalesInsightsData | null;
  isLoading: boolean;
  error: string | null;
  cashOutError: string | null;
}

interface PageResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

async function fetchAll<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResponse>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

const CASH_OUT_LABELS: Record<string, string> = Object.fromEntries(
  CASH_CATEGORIES.OUT.map((option) => [option.value, option.label]),
);

interface PeriodData {
  summary: SalesSummary;
  items: SaleItemLite[];
  payments: PaymentLite[];
}

/**
 * Satu periode: transaksi PAID + RETURN (VOID dibuang), item penjualan, dan —
 * hanya kalau `withDetails` — kolom produk untuk "produk terlaris" serta
 * pembayaran untuk bauran metode bayar.
 */
async function loadPeriod(range: DateRange, withDetails: boolean): Promise<PeriodData> {
  const transactions = await fetchAll<TransactionLite>((from, to) =>
    supabase
      .from("transactions")
      .select("id, total, status, related_transaction_id")
      .in("status", ["PAID", "RETURN"])
      .is("deleted_at", null)
      .gte("created_at", range.start.toISOString())
      .lte("created_at", range.end.toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const saleIds = transactions
    .filter((trx) => trx.related_transaction_id === null)
    .map((trx) => trx.id);

  const itemColumns = withDetails
    ? "id, transaction_id, product_id, product_name, qty, returned_qty, subtotal"
    : "id, transaction_id, qty, returned_qty";

  const items: SaleItemLite[] = [];
  const payments: PaymentLite[] = [];

  for (const ids of chunk(saleIds, ID_CHUNK_SIZE)) {
    const itemRows = await fetchAll<SaleItemLite>((from, to) =>
      supabase
        .from("transaction_items")
        .select(itemColumns)
        .in("transaction_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    items.push(...itemRows);

    if (withDetails) {
      const paymentRows = await fetchAll<PaymentLite>((from, to) =>
        supabase
          .from("payments")
          .select("id, transaction_id, method, amount")
          .in("transaction_id", ids)
          .order("id", { ascending: true })
          .range(from, to),
      );
      payments.push(...paymentRows);
    }
  }

  return { summary: summarizeSales(transactions, items), items, payments };
}

async function loadCashOut(range: DateRange): Promise<CashOutSummary> {
  const rows = await fetchAll<CashOutLite>((from, to) =>
    supabase
      .from("cash_movements")
      .select("id, category, amount")
      .eq("type", "OUT")
      .is("voided_at", null)
      .gte("created_at", range.start.toISOString())
      .lte("created_at", range.end.toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return buildCashOut(rows, CASH_OUT_LABELS);
}

export function useSalesInsights(
  dateRange: DateRange,
  options: { enabled?: boolean } = {},
): UseSalesInsightsResult {
  const enabled = options.enabled ?? true;
  const startMs = dateRange.start.getTime();
  const endMs = dateRange.end.getTime();

  const [data, setData] = useState<SalesInsightsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashOutError, setCashOutError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setCashOutError(null);

      const range: DateRange = { start: new Date(startMs), end: new Date(endMs) };
      const compareRange = previousRange(range);

      try {
        const [current, previous, cash] = await Promise.all([
          loadPeriod(range, true),
          loadPeriod(compareRange, false),
          loadCashOut(range).then(
            (summary) => ({ summary, message: null as string | null }),
            (err: unknown) => ({
              summary: null as CashOutSummary | null,
              message: err instanceof Error ? err.message : "Gagal memuat kas keluar.",
            }),
          ),
        ]);

        if (isCancelled) return;

        setData({
          currentSummary: current.summary,
          previousSummary: previous.summary,
          previousRange: compareRange,
          paymentMix: buildPaymentMix(current.payments),
          topProducts: buildTopProducts(current.items, 10),
          cashOut: cash.summary,
        });
        setCashOutError(cash.message);
      } catch (err) {
        if (isCancelled) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Gagal memuat wawasan penjualan.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [enabled, startMs, endMs]);

  return { data, isLoading, error, cashOutError };
}