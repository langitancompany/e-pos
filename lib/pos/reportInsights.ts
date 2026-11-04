// lib/pos/reportInsights.ts
// ── TAMBAHAN (Laporan, adopsi ide dari "Laporan Harian" Kula POS) ──────────
// Fungsi MURNI (tanpa Supabase, tanpa React) untuk bagian tambahan tab
// Harian/Bulanan: rentang pembanding, ringkasan penjualan, bauran metode
// bayar, produk terlaris, dan kas keluar per kategori.
//
// Dipisah dari hooks/useSalesInsights.ts supaya mudah diuji tanpa database
// dan tidak menggemukkan hooks/useReports.ts.
//
// Aturan yang SAMA dengan hooks/useReports.ts (supaya angka tidak berbeda):
// - Omzet = status PAID + RETURN (baris RETURN bernilai negatif), VOID dibuang.
// - Jumlah transaksi = hanya baris penjualan (related_transaction_id kosong).
// - Item terjual = qty - returned_qty per item, item bernilai <= 0 diabaikan.
// - Semua pengelompokan tanggal pakai waktu LOKAL (WIB), bukan UTC.

import type { DateRange } from "@/lib/pos/dateRange";
import type { SalesSummary } from "@/lib/pos/reportLogic";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Tanggal ──────────────────────────────────────────────────────────────────

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

/**
 * Rentang pembanding: sepanjang rentang terpilih (dihitung per hari kalender),
 * tepat sebelum rentang itu. Contoh: 1-15 Okt -> pembanding 16-30 Sep.
 */
export function previousRange(range: DateRange): DateRange {
  const start = startOfDay(range.start);
  const end = startOfDay(range.end);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  return {
    start: addDays(start, -days),
    end: endOfDay(addDays(start, -1)),
  };
}

// ── Bentuk data mentah (subset kolom yang dipakai) ───────────────────────────

export interface TransactionLite {
  id: string;
  total: number;
  status: string;
  related_transaction_id: string | null;
}

export interface SaleItemLite {
  transaction_id: string;
  product_id?: string | null;
  product_name?: string | null;
  qty: number;
  returned_qty: number;
  subtotal?: number;
}

export interface PaymentLite {
  transaction_id: string;
  method: string;
  amount: number;
}

export interface CashOutLite {
  category: string;
  amount: number;
}

// ── Ringkasan penjualan ──────────────────────────────────────────────────────

export function summarizeSales(
  transactions: TransactionLite[],
  items: SaleItemLite[],
): SalesSummary {
  let revenue = 0;
  let transactionCount = 0;
  for (const trx of transactions) {
    revenue += Number(trx.total ?? 0);
    if (trx.related_transaction_id === null) transactionCount += 1;
  }

  let itemsSold = 0;
  for (const item of items) {
    const netQty = Number(item.qty ?? 0) - Number(item.returned_qty ?? 0);
    if (netQty > 0) itemsSold += netQty;
  }

  return {
    revenue,
    transactionCount,
    itemsSold,
    averageTicket: transactionCount > 0 ? Math.round(revenue / transactionCount) : 0,
  };
}

/**
 * Persentase perubahan terhadap pembanding. null = pembanding 0 (tidak bisa
 * dihitung persennya) — komponen yang memutuskan teks apa yang ditampilkan.
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ── Bauran metode pembayaran ─────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  tunai: "Tunai",
  transfer: "Transfer bank",
  qris: "QRIS",
  tempo: "Tempo (piutang)",
  lainnya: "Lainnya",
};

/**
 * Enum payment_method di database campuran nilai lama dan baru
 * ('tunai'/'CASH', 'transfer'/'BANK_TRANSFER', 'QRIS', 'TEMPO', 'lainnya').
 * Disatukan ke satu kunci supaya tidak muncul dua baris "Tunai".
 */
export function normalizeMethod(method: string | null | undefined): string {
  const m = (method ?? "").trim().toLowerCase();
  if (m === "cash" || m === "tunai") return "tunai";
  if (m === "bank_transfer" || m === "transfer") return "transfer";
  if (m === "qris") return "qris";
  if (m === "tempo") return "tempo";
  if (m === "" || m === "lainnya") return "lainnya";
  return m;
}

export function methodLabel(key: string): string {
  const known = METHOD_LABELS[key];
  if (known) return known;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export interface PaymentMixRow {
  key: string;
  label: string;
  amount: number;
  /** Jumlah transaksi yang memakai metode ini (transaksi split dihitung sekali per metode). */
  transactionCount: number;
}

export function buildPaymentMix(payments: PaymentLite[]): PaymentMixRow[] {
  const map = new Map<string, { amount: number; trx: Set<string> }>();
  for (const payment of payments) {
    const key = normalizeMethod(payment.method);
    const entry = map.get(key) ?? { amount: 0, trx: new Set<string>() };
    entry.amount += Number(payment.amount ?? 0);
    entry.trx.add(payment.transaction_id);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, entry]) => ({
      key,
      label: methodLabel(key),
      amount: entry.amount,
      transactionCount: entry.trx.size,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ── Produk terlaris ──────────────────────────────────────────────────────────

export interface TopProductRow {
  key: string;
  name: string;
  /** Jumlah terjual bersih (qty dikurangi yang diretur). */
  qty: number;
  /** Omzet bersih: subtotal dikurangi bagian yang diretur (proporsional). */
  revenue: number;
}

export function buildTopProducts(items: SaleItemLite[], limit = 10): TopProductRow[] {
  const map = new Map<string, TopProductRow>();
  for (const item of items) {
    const qty = Number(item.qty ?? 0);
    const returned = Number(item.returned_qty ?? 0);
    const netQty = qty - returned;
    if (netQty <= 0 || qty <= 0) continue;

    const subtotal = Number(item.subtotal ?? 0);
    const netRevenue = subtotal - Math.round((subtotal * returned) / qty);

    const name = item.product_name?.trim() || "Tanpa nama";
    const key = item.product_id ?? `nama:${name.toLowerCase()}`;
    const entry = map.get(key) ?? { key, name, qty: 0, revenue: 0 };
    entry.qty += netQty;
    entry.revenue += netRevenue;
    map.set(key, entry);
  }
  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
    .slice(0, limit);
}

// ── Kas keluar per kategori ──────────────────────────────────────────────────

export interface CashOutRow {
  category: string;
  label: string;
  amount: number;
  count: number;
}

export interface CashOutSummary {
  rows: CashOutRow[];
  total: number;
}

export function buildCashOut(
  movements: CashOutLite[],
  labels: Record<string, string>,
): CashOutSummary {
  const map = new Map<string, CashOutRow>();
  let total = 0;
  for (const movement of movements) {
    const amount = Number(movement.amount ?? 0);
    const entry = map.get(movement.category) ?? {
      category: movement.category,
      label: labels[movement.category] ?? movement.category,
      amount: 0,
      count: 0,
    };
    entry.amount += amount;
    entry.count += 1;
    total += amount;
    map.set(movement.category, entry);
  }
  return {
    rows: Array.from(map.values()).sort((a, b) => b.amount - a.amount),
    total,
  };
}