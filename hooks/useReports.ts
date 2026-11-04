// hooks/useReports.ts
// ── TAMBAHAN (T-08) ── Hook domain Laporan (PRD §17 Fase E, §4.5, §4.7).
// Menyediakan data untuk 3 sub-tab yang diminta PRD:
//   - Per Shift        → riwayat shift semua kasir (bukan cuma milik sendiri,
//                         beda dengan hooks/useShifts.ts yang khusus user login).
//   - Harian/Bulanan    → ringkasan omzet + deret harian untuk rentang tanggal
//                         BEBAS (beda dengan hooks/useDashboard.ts yang terkunci
//                         "hari ini" & "bulan berjalan" saja).
//   - Piutang/Tempo     → daftar payment TEMPO + status Lunas/Belum/Jatuh Tempo
//                         (kolom `is_settled` dari migration 012) + aksi
//                         menandai lunas lewat RPC `settle_receivable`.
//
// ═══════════════════════════════════════════════════════════════════════════
// ASUMSI YANG PERLU DIKONFIRMASI KE PRD (bukan tebakan sembarangan, tapi belum
// ada teks PRD eksplisit yang terbaca sejauh sesi ini untuk 2 hal berikut):
// ═══════════════════════════════════════════════════════════════════════════
// 1. **Akses modul Laporan: diasumsikan admin/supervisor saja**, pola sama
//    seperti StokModule.tsx ("kasir TIDAK punya akses, PRD §5 baris `stok`").
//    Laporan berisi omzet & selisih kas semua kasir — masuk akal dibatasi sama
//    seperti Stok, tapi ini ASUMSI, bukan dikutip langsung dari §5. Kalau salah,
//    ubah flag `canViewReports` di komponen (LaporanModule.tsx, belum dibuat)
//    yang memakai hook ini — hook ini sendiri TIDAK melakukan pengecekan role
//    apapun (sama seperti useStock.ts, biar reusable & gampang ditest).
// 2. **Piutang/Tempo TIDAK ikut difilter rentang tanggal** seperti 2 sub-tab
//    lain — daftar piutang selalu menampilkan SEMUA payment TEMPO yang belum
//    lunas (+ 30 hari terakhir yang sudah lunas, biar tetap kelihatan riwayat
//    pelunasan terbaru), diurutkan jatuh tempo terdekat dulu. Alasannya: piutang
//    yang jatuh tempo bulan lalu tetap harus terlihat & bisa ditagih walau
//    filter Laporan sedang di "bulan ini" — kalau ikut difilter rentang, piutang
//    lama berisiko "hilang dari radar" begitu bulan berganti.
//
// ── REVISI (rentang tanggal per tab) ──
// Hook ini TIDAK lagi memegang satu rentang tanggal global. Pemanggil
// (LaporanModule.tsx) memberi rentang terpisah untuk Harian/Bulanan
// (`salesRange`) dan Per Shift (`shiftRange`), yang state-nya dipegang oleh
// hooks/useReportDateRange.ts. Tiap bagian (penjualan, shift, piutang) punya
// efek, status loading, dan error sendiri — mengganti rentang di satu tab
// tidak memicu fetch ulang tab lain. Piutang tetap tanpa rentang (catatan #2).
//
// ── Keputusan desain lain ──
// - **Agregasi Harian/Bulanan dilakukan di client**, pola sama persis seperti
//   useDashboard.ts (T-06): rentang tanggal laporan toko masih kecil, dan ini
//   ringkasan read-only. Kalau nanti dipindah ke RPC, bentuk return sengaja
//   dibuat datar (SalesSummary/DailySalesPoint) supaya komponen tidak perlu
//   diubah.
// - **Omzet = status PAID + RETURN, VOID dibuang** — alasan identik dengan
//   useDashboard.ts: baris RETURN bernilai total negatif, menjumlahkan
//   keduanya menghasilkan omzet BERSIH yang benar. Baca komentar lengkap di
//   hooks/useDashboard.ts kalau butuh detail, tidak diulang semua di sini.
// - **Semua pengelompokan tanggal pakai waktu LOKAL** (`dateKey()`), bukan
//   `toISOString()` — WIB (UTC+7) butuh ini, sama seperti useDashboard.ts &
//   RPC get_transaction_by_receipt (migration 010).
// - **Nama kasir di laporan shift diambil lewat query terpisah** ke `profiles`
//   (bukan embed PostgREST) — konsisten dengan alasan di useDashboard.ts &
//   useStock.ts: bentuk FK tidak seragam antara scripts/setup-database.sql dan
//   rantai migration.
// - **Shift yang masih OPEN ikut ditampilkan** di rentang tanggal (bukan cuma
//   CLOSED) — supervisor perlu tahu ada shift yang belum ditutup dalam rentang
//   yang dia lihat, bukan cuma shift yang sudah selesai.
// - **`settleReceivable()` di sini HANYA memanggil RPC + refetch.** Upload bukti
//   (tabel `payment_proofs`) sudah dihapus di migration 034 — pelunasan piutang
//   cukup ditandai lunas lewat RPC.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
// ── TAMBAHAN (migration 040) ── total kas masuk/keluar per shift untuk tab Per Shift.
import { fetchCashTotalsByShift } from "@/hooks/useCashMovements";
import { useBranchScope } from "@/hooks/useActiveBranch";
import { branchFilter } from "@/lib/pos/branches";
import { addDays, chunk, startOfDay, type DateRange } from "@/lib/pos/dateRange";
// ── Logika hitung dipindahkan ke lib/pos/dateRange.ts & lib/pos/reportLogic.ts
// (fungsi murni, ada testnya). Hook ini hanya mengambil data dari Supabase lalu
// menyerahkannya ke sana. Tipe & presetToRange di-ekspor ulang supaya import
// lama (`@/hooks/useReports`) tetap jalan.
import {
  buildReceivableRows,
  buildSalesReport,
  buildShiftRows,
  emptySummary,
  type CashTotalsByShift,
  type DailySalesPoint,
  type RawPayment,
  type RawSalesItem,
  type RawSalesTransaction,
  type RawShift,
  type RawTransactionLite,
  type ReceivableRow,
  type SalesSummary,
  type ShiftReportRow,
} from "@/lib/pos/reportLogic";

export { presetToRange } from "@/lib/pos/dateRange";
export type { DateRange, ReportDatePreset } from "@/lib/pos/dateRange";
export type {
  DailySalesPoint,
  ReceivableRow,
  ReceivableStatus,
  SalesSummary,
  ShiftReportRow,
} from "@/lib/pos/reportLogic";

const supabase = createClient();

// ── Hasil hook ───────────────────────────────────────────────────────────────

export interface UseReportsOptions {
  /** Rentang untuk tab Harian/Bulanan. */
  salesRange: DateRange;
  /** Rentang untuk tab Per Shift. */
  shiftRange: DateRange;
}

interface UseReportsResult {
  salesSummary: SalesSummary;
  dailySales: DailySalesPoint[];
  isSalesLoading: boolean;
  salesError: string | null;

  shifts: ShiftReportRow[];
  isShiftsLoading: boolean;
  shiftsError: string | null;

  receivables: ReceivableRow[];
  isReceivablesLoading: boolean;
  receivablesError: string | null;

  /** Menandai satu payment TEMPO lunas lewat RPC `settle_receivable` (migration 012). */
  settleReceivable: (paymentId: string) => Promise<void>;
}

const RECEIVABLES_SETTLED_LOOKBACK_DAYS = 30;

export function useReports({
  salesRange,
  shiftRange,
}: UseReportsOptions): UseReportsResult {
  // Dependency efek pakai epoch ms (bukan objek Date) supaya identitas objek
  // rentang yang berubah tanpa perubahan nilai tidak memicu fetch ulang.
  const salesStartMs = salesRange.start.getTime();
  const salesEndMs = salesRange.end.getTime();
  const shiftStartMs = shiftRange.start.getTime();
  const shiftEndMs = shiftRange.end.getTime();

  const [salesSummary, setSalesSummary] = useState<SalesSummary>(emptySummary);
  const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
  const [isSalesLoading, setIsSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState<string | null>(null);

  const [shifts, setShifts] = useState<ShiftReportRow[]>([]);
  const [isShiftsLoading, setIsShiftsLoading] = useState(true);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [isReceivablesLoading, setIsReceivablesLoading] = useState(true);
  const [receivablesError, setReceivablesError] = useState<string | null>(null);
  const [receivablesReloadToken, setReceivablesReloadToken] = useState(0);

  // ── TAMBAHAN (migration 047) ── Penjualan & shift hanya untuk cabang terpilih.
  const { branchId, ready } = useBranchScope();

  const refetchReceivables = useCallback(
    () => setReceivablesReloadToken((t) => t + 1),
    [],
  );

  // ── 1. Harian/Bulanan — mengikuti `salesRange` ───────────────────────────
  useEffect(() => {
    if (!ready) return;
    let isCancelled = false;
    const rangeStart = new Date(salesStartMs);
    const rangeEnd = new Date(salesEndMs);

    async function load() {
      setIsSalesLoading(true);
      setSalesError(null);

      try {
        const { data: trxData, error: trxError } = await supabase
          .from("transactions")
          .select("id, total, status, created_at, related_transaction_id")
          .match(branchFilter(branchId))
          .in("status", ["PAID", "RETURN"])
          .is("deleted_at", null)
          .gte("created_at", rangeStart.toISOString())
          .lte("created_at", rangeEnd.toISOString())
          .order("created_at", { ascending: true });

        if (trxError) throw new Error(trxError.message);
        const transactions = (trxData ?? []) as RawSalesTransaction[];

        const saleIds = transactions
          .filter((trx) => trx.related_transaction_id === null)
          .map((trx) => trx.id);

        const items: RawSalesItem[] = [];
        for (const ids of chunk(saleIds, 150)) {
          const { data: itemData, error: itemError } = await supabase
            .from("transaction_items")
            .select("transaction_id, qty, returned_qty")
            .in("transaction_id", ids);
          if (itemError) throw new Error(itemError.message);
          items.push(...((itemData ?? []) as RawSalesItem[]));
        }

        if (isCancelled) return;

        // Agregasi: fungsi murni di lib/pos/reportLogic.ts.
        const report = buildSalesReport(transactions, items, {
          start: rangeStart,
          end: rangeEnd,
        });

        setSalesSummary(report.summary);
        setDailySales(report.daily);
        setIsSalesLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error("useReports (penjualan) load error:", err);
        setSalesError(
          err instanceof Error ? err.message : "Gagal memuat data penjualan.",
        );
        setIsSalesLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [salesStartMs, salesEndMs, branchId, ready]);

  // ── 2. Per Shift — mengikuti `shiftRange` ────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    let isCancelled = false;
    const rangeStart = new Date(shiftStartMs);
    const rangeEnd = new Date(shiftEndMs);

    async function load() {
      setIsShiftsLoading(true);
      setShiftsError(null);

      try {
        const { data: shiftData, error: shiftError } = await supabase
          .from("shift_sessions")
          .select(
            "id, cashier_id, opened_at, closed_at, status, opening_cash, expected_cash, actual_cash, difference",
          )
          .match(branchFilter(branchId))
          .gte("opened_at", rangeStart.toISOString())
          .lte("opened_at", rangeEnd.toISOString())
          .order("opened_at", { ascending: false });

        if (shiftError) throw new Error(shiftError.message);
        const rawShifts = (shiftData ?? []) as RawShift[];

        const cashierIds = Array.from(new Set(rawShifts.map((s) => s.cashier_id)));
        const cashierNameById = new Map<string, string | null>();
        for (const ids of chunk(cashierIds, 150)) {
          const { data: profileData, error: profileError } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", ids);
          if (profileError) throw new Error(profileError.message);
          for (const p of profileData ?? []) {
            cashierNameById.set(p.id, p.full_name ?? null);
          }
        }

        // ── TAMBAHAN (040) ── Kegagalan memuat kas masuk/keluar TIDAK
        // menggagalkan seluruh laporan: kolomnya jadi "-" saja.
        let cashTotals: CashTotalsByShift | null = null;
        try {
          cashTotals = await fetchCashTotalsByShift(rawShifts.map((s) => s.id));
        } catch (cashError) {
          console.error("useReports: gagal memuat kas masuk/keluar:", cashError);
        }

        if (isCancelled) return;

        const shiftRows: ShiftReportRow[] = buildShiftRows(
          rawShifts,
          cashierNameById,
          cashTotals,
        );

        setShifts(shiftRows);
        setIsShiftsLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error("useReports (shift) load error:", err);
        setShiftsError(
          err instanceof Error ? err.message : "Gagal memuat data shift.",
        );
        setIsShiftsLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [shiftStartMs, shiftEndMs, branchId, ready]);

  // ── 3. Piutang/Tempo — TANPA rentang, lihat catatan #2 di header ─────────
  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsReceivablesLoading(true);
      setReceivablesError(null);

      try {
        const lookback = addDays(
          startOfDay(new Date()),
          -RECEIVABLES_SETTLED_LOOKBACK_DAYS,
        );

        const { data: paymentData, error: paymentError } = await supabase
          .from("payments")
          .select("id, transaction_id, amount, due_date, is_settled, settled_at, created_at")
          .eq("method", "TEMPO")
          .or(`is_settled.eq.false,settled_at.gte.${lookback.toISOString()}`)
          .order("due_date", { ascending: true })
          .limit(300);

        if (paymentError) throw new Error(paymentError.message);
        const rawPayments = (paymentData ?? []) as RawPayment[];

        const trxIds = Array.from(new Set(rawPayments.map((p) => p.transaction_id)));
        const trxLiteById = new Map<string, RawTransactionLite>();
        for (const ids of chunk(trxIds, 150)) {
          const { data: trxLiteData, error: trxLiteError } = await supabase
            .from("transactions")
            .select("id, receipt_no, customer_name")
            .in("id", ids);
          if (trxLiteError) throw new Error(trxLiteError.message);
          for (const t of (trxLiteData ?? []) as RawTransactionLite[]) {
            trxLiteById.set(t.id, t);
          }
        }

        if (isCancelled) return;

        const receivableRows: ReceivableRow[] = buildReceivableRows(
          rawPayments,
          trxLiteById,
        );

        setReceivables(receivableRows);
        setIsReceivablesLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error("useReports (piutang) load error:", err);
        setReceivablesError(
          err instanceof Error ? err.message : "Gagal memuat data piutang.",
        );
        setIsReceivablesLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [receivablesReloadToken]);

  const settleReceivable = useCallback(
    async (paymentId: string) => {
      const { data, error: rpcError } = await supabase.rpc("settle_receivable", {
        p_payment_id: paymentId,
      });

      if (rpcError) {
        console.error("settle_receivable RPC error:", rpcError);
        throw new Error(rpcError.message || "Gagal menandai piutang lunas.");
      }

      if (!data?.success) {
        throw new Error("Piutang gagal ditandai lunas.");
      }

      refetchReceivables();
    },
    [refetchReceivables],
  );

  return {
    salesSummary,
    dailySales,
    isSalesLoading,
    salesError,
    shifts,
    isShiftsLoading,
    shiftsError,
    receivables,
    isReceivablesLoading,
    receivablesError,
    settleReceivable,
  };
}
