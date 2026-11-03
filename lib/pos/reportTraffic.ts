// lib/pos/reportTraffic.ts
// ── TAMBAHAN (Laporan, adopsi ide dari tab "Jam & Hari Ramai" dan "Retur" Kula POS) ──
// Fungsi MURNI (tanpa Supabase/React) untuk dua tab laporan baru.
//
// Jam & Hari Ramai:
// - Dihitung dari transaksi PENJUALAN berstatus PAID (related_transaction_id
//   kosong), menurut jam pembuatan transaksi, waktu LOKAL (WIB), bukan UTC.
// - Omzet di sini = total penjualan SEBELUM dikurangi retur: tab ini mengukur
//   keramaian, bukan laba. Nilai bersih ada di tab Harian/Bulanan.
//
// Retur:
// - Satu baris = satu transaksi berstatus RETURN (total negatif, terhubung ke
//   struk asal lewat related_transaction_id). Alasan retur disimpan di kolom
//   `void_reason` (dipakai bersama void). Jumlah item per retur dan metode
//   refund TIDAK disimpan per retur di database ini, jadi tidak ditampilkan.

export interface SaleLite {
  total: number;
  created_at: string;
}

export interface HourlyPoint {
  hour: number;
  label: string;
  count: number;
  revenue: number;
  averageSpend: number;
}

export interface WeekdayPoint {
  /** 0 = Minggu ... 6 = Sabtu (sama dengan Date.getDay()). */
  day: number;
  name: string;
  count: number;
  revenue: number;
}

export interface TrafficReport {
  totalCount: number;
  totalRevenue: number;
  /** null = belum ada transaksi di rentang. */
  peakHour: { hour: number; label: string; count: number; revenue: number } | null;
  busiestDay: WeekdayPoint | null;
  hourly: HourlyPoint[];
  /** Urut Senin sampai Minggu. */
  weekdays: WeekdayPoint[];
}

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
// Tampilan Senin lebih dulu (kebiasaan di Indonesia).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildTraffic(sales: SaleLite[]): TrafficReport {
  const hourly: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${pad2(hour)}:00`,
    count: 0,
    revenue: 0,
    averageSpend: 0,
  }));
  const byDay: WeekdayPoint[] = DAY_NAMES.map((name, day) => ({
    day,
    name,
    count: 0,
    revenue: 0,
  }));

  let totalCount = 0;
  let totalRevenue = 0;

  for (const sale of sales) {
    const date = new Date(sale.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const total = Number(sale.total ?? 0);

    const hourPoint = hourly[date.getHours()];
    hourPoint.count += 1;
    hourPoint.revenue += total;

    const dayPoint = byDay[date.getDay()];
    dayPoint.count += 1;
    dayPoint.revenue += total;

    totalCount += 1;
    totalRevenue += total;
  }

  for (const point of hourly) {
    point.averageSpend = point.count > 0 ? Math.round(point.revenue / point.count) : 0;
  }

  let peak: HourlyPoint | null = null;
  for (const point of hourly) {
    if (point.count > 0 && (peak === null || point.count > peak.count)) peak = point;
  }

  const weekdays = WEEK_ORDER.map((day) => byDay[day]);
  let busiest: WeekdayPoint | null = null;
  for (const point of weekdays) {
    if (point.count > 0 && (busiest === null || point.count > busiest.count)) busiest = point;
  }

  return {
    totalCount,
    totalRevenue,
    peakHour: peak
      ? {
          hour: peak.hour,
          label: `${pad2(peak.hour)}:00 - ${pad2((peak.hour + 1) % 24)}:00`,
          count: peak.count,
          revenue: peak.revenue,
        }
      : null,
    busiestDay: busiest,
    hourly,
    weekdays,
  };
}

// ── Retur ────────────────────────────────────────────────────────────────────

export interface ReturnTrxLite {
  id: string;
  receipt_no: string;
  total: number;
  created_at: string;
  cashier_id: string | null;
  void_reason: string | null;
  related_transaction_id: string | null;
}

export interface ReturnRow {
  id: string;
  receiptNo: string;
  createdAt: string;
  originalReceiptNo: string | null;
  cashierName: string | null;
  reason: string | null;
  /** Nominal refund (selalu positif). */
  refund: number;
}

export interface ReturnsReport {
  rows: ReturnRow[];
  count: number;
  totalRefund: number;
}

export function buildReturnsReport(
  returns: ReturnTrxLite[],
  originalReceipts: Map<string, string>,
  cashierNames: Map<string, string | null>,
): ReturnsReport {
  const rows: ReturnRow[] = returns
    .map((trx) => ({
      id: trx.id,
      receiptNo: trx.receipt_no,
      createdAt: trx.created_at,
      originalReceiptNo: trx.related_transaction_id
        ? (originalReceipts.get(trx.related_transaction_id) ?? null)
        : null,
      cashierName: trx.cashier_id ? (cashierNames.get(trx.cashier_id) ?? null) : null,
      reason: trx.void_reason?.trim() || null,
      refund: Math.abs(Number(trx.total ?? 0)),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return {
    rows,
    count: rows.length,
    totalRefund: rows.reduce((sum, row) => sum + row.refund, 0),
  };
}