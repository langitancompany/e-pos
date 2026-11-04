// lib/pos/reportLogic.ts
// ── Logika hitung Laporan (MURNI — tanpa React/Supabase) ───────────────────
// Dipindahkan dari hooks/useReports.ts supaya bisa dites. Hook tetap yang
// mengambil data dari Supabase; file ini hanya mengubah baris mentah jadi
// angka/baris tampilan. Perilakunya tidak diubah.
//
// Aturan hitung sama dengan lib/pos/dashboardLogic.ts:
// - Omzet = status PAID + RETURN (RETURN bernilai negatif), VOID dibuang.
// - Jumlah transaksi = hanya baris penjualan (related_transaction_id NULL).
// - Item terjual = qty - returned_qty, netto <= 0 diabaikan.
// - Pengelompokan tanggal pakai waktu LOKAL.

import {
  addDays,
  dateKey,
  shortLabel,
  startOfDay,
  type DateRange,
} from "@/lib/pos/dateRange";

// ── Tipe publik: Harian/Bulanan ──────────────────────────────────────────────

export interface SalesSummary {
  revenue: number;
  transactionCount: number;
  itemsSold: number;
  averageTicket: number;
}

export interface DailySalesPoint {
  date: string;
  label: string;
  revenue: number;
  transactionCount: number;
}

export function emptySummary(): SalesSummary {
  return { revenue: 0, transactionCount: 0, itemsSold: 0, averageTicket: 0 };
}

// ── Tipe publik: Per Shift ───────────────────────────────────────────────────

export interface ShiftReportRow {
  id: string;
  cashier_id: string;
  cashier_name: string | null;
  opened_at: string;
  closed_at: string | null;
  status: "OPEN" | "CLOSED";
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
  /**
   * Total kas masuk / kas keluar yang dicatat di shift ini (catatan yang
   * dibatalkan tidak dihitung). null = gagal dimuat (ditampilkan "-", BUKAN 0,
   * supaya tidak terbaca seolah tidak ada kas keluar).
   */
  cash_in: number | null;
  cash_out: number | null;
}

// ── Tipe publik: Piutang/Tempo ───────────────────────────────────────────────

export type ReceivableStatus = "LUNAS" | "JATUH_TEMPO" | "BELUM_LUNAS";

export interface ReceivableRow {
  payment_id: string;
  transaction_id: string;
  receipt_no: string;
  customer_name: string | null;
  amount: number;
  due_date: string | null;
  is_settled: boolean;
  settled_at: string | null;
  status: ReceivableStatus;
  created_at: string;
}

// ── Bentuk baris mentah dari Supabase ────────────────────────────────────────

export interface RawSalesTransaction {
  id: string;
  total: number | null;
  status: string;
  created_at: string;
  related_transaction_id: string | null;
}

export interface RawSalesItem {
  transaction_id: string;
  qty: number | null;
  returned_qty: number | null;
}

export interface RawShift {
  id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  status: "OPEN" | "CLOSED";
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
}

export interface RawPayment {
  id: string;
  transaction_id: string;
  amount: number;
  due_date: string | null;
  is_settled: boolean;
  settled_at: string | null;
  created_at: string;
}

export interface RawTransactionLite {
  id: string;
  receipt_no: string;
  customer_name: string | null;
}

/** Bentuk yang sama dengan hasil fetchCashTotalsByShift (hooks/useCashMovements.ts). */
export type CashTotalsByShift = Record<
  string,
  { cashIn: number; cashOut: number }
>;

// ── Harian/Bulanan ───────────────────────────────────────────────────────────

export interface SalesReport {
  summary: SalesSummary;
  daily: DailySalesPoint[];
}

/**
 * Ringkasan + deret harian untuk rentang bebas. Satu titik harian dibuat untuk
 * SETIAP hari dalam rentang (termasuk yang nol transaksi).
 */
export function buildSalesReport(
  transactions: RawSalesTransaction[],
  items: RawSalesItem[],
  range: DateRange,
): SalesReport {
  const dailyMap = new Map<string, DailySalesPoint>();
  for (
    let cursor = startOfDay(range.start);
    cursor <= range.end;
    cursor = addDays(cursor, 1)
  ) {
    dailyMap.set(dateKey(cursor), {
      date: dateKey(cursor),
      label: shortLabel(cursor),
      revenue: 0,
      transactionCount: 0,
    });
  }

  const summary = emptySummary();
  for (const trx of transactions) {
    const total = Number(trx.total ?? 0);
    const isSale = trx.related_transaction_id === null;
    const createdAt = new Date(trx.created_at);

    summary.revenue += total;
    if (isSale) summary.transactionCount += 1;

    const point = dailyMap.get(dateKey(createdAt));
    if (point) {
      point.revenue += total;
      if (isSale) point.transactionCount += 1;
    }
  }

  const itemsByTransaction = new Map<string, number>();
  for (const item of items) {
    const netQty = Number(item.qty ?? 0) - Number(item.returned_qty ?? 0);
    if (netQty <= 0) continue;
    itemsByTransaction.set(
      item.transaction_id,
      (itemsByTransaction.get(item.transaction_id) ?? 0) + netQty,
    );
  }
  summary.itemsSold = Array.from(itemsByTransaction.values()).reduce(
    (sum, qty) => sum + qty,
    0,
  );
  summary.averageTicket =
    summary.transactionCount > 0
      ? Math.round(summary.revenue / summary.transactionCount)
      : 0;

  return { summary, daily: Array.from(dailyMap.values()) };
}

// ── Per Shift ────────────────────────────────────────────────────────────────

/**
 * Baris laporan shift. `cashTotals` null = pemuatan kas masuk/keluar gagal →
 * `cash_in`/`cash_out` null (tampil "-"). Shift yang tidak punya catatan kas
 * di `cashTotals` dianggap 0.
 */
export function buildShiftRows(
  rawShifts: RawShift[],
  cashierNameById: Map<string, string | null>,
  cashTotals: CashTotalsByShift | null,
): ShiftReportRow[] {
  return rawShifts.map((s) => ({
    id: s.id,
    cashier_id: s.cashier_id,
    cashier_name: cashierNameById.get(s.cashier_id) ?? null,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    status: s.status,
    opening_cash: Number(s.opening_cash ?? 0),
    expected_cash: s.expected_cash === null ? null : Number(s.expected_cash),
    actual_cash: s.actual_cash === null ? null : Number(s.actual_cash),
    difference: s.difference === null ? null : Number(s.difference),
    cash_in: cashTotals ? (cashTotals[s.id]?.cashIn ?? 0) : null,
    cash_out: cashTotals ? (cashTotals[s.id]?.cashOut ?? 0) : null,
  }));
}

// ── Piutang/Tempo ────────────────────────────────────────────────────────────

/**
 * Status piutang: LUNAS kalau sudah ditandai; JATUH_TEMPO kalau jatuh tempo
 * SEBELUM hari ini (jatuh tempo hari ini belum dianggap lewat); selain itu
 * BELUM_LUNAS. `now` bisa disuntik untuk tes.
 */
export function receivableStatus(
  dueDate: string | null,
  isSettled: boolean,
  now: Date = new Date(),
): ReceivableStatus {
  if (isSettled) return "LUNAS";
  if (dueDate && dueDate < dateKey(now)) return "JATUH_TEMPO";
  return "BELUM_LUNAS";
}

/** Baris piutang; urutan input dipertahankan (query sudah mengurutkan jatuh tempo). */
export function buildReceivableRows(
  rawPayments: RawPayment[],
  trxLiteById: Map<string, RawTransactionLite>,
  now: Date = new Date(),
): ReceivableRow[] {
  return rawPayments.map((p) => {
    const trx = trxLiteById.get(p.transaction_id);
    return {
      payment_id: p.id,
      transaction_id: p.transaction_id,
      receipt_no: trx?.receipt_no ?? "-",
      customer_name: trx?.customer_name ?? null,
      amount: Number(p.amount ?? 0),
      due_date: p.due_date,
      is_settled: p.is_settled,
      settled_at: p.settled_at,
      status: receivableStatus(p.due_date, p.is_settled, now),
      created_at: p.created_at,
    };
  });
}
