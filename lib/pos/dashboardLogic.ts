// lib/pos/dashboardLogic.ts
// ── Logika hitung Dashboard (MURNI — tanpa React/Supabase) ─────────────────
// Dipindahkan dari hooks/useDashboard.ts supaya bisa dites. Hook tetap yang
// mengambil data dari Supabase; file ini hanya mengubah baris mentah jadi
// angka. Perilakunya tidak diubah.
//
// Keputusan hitung yang berlaku (penjelasan lengkap ada di header
// hooks/useDashboard.ts):
//  1. OMZET = SUM(total) status PAID **dan** RETURN. Baris RETURN bernilai
//     negatif, jadi hasilnya omzet BERSIH. VOID tidak pernah masuk.
//  2. JUMLAH TRANSAKSI hanya baris PENJUALAN (`related_transaction_id` NULL).
//  3. ITEM TERJUAL = qty - returned_qty dari item transaksi ASLI; netto <= 0
//     diabaikan.
//  4. Semua pengelompokan tanggal pakai waktu LOKAL.

import {
  addDays,
  dateKey,
  shortLabel,
  startOfDay,
} from "@/lib/pos/dateRange";

/** Jumlah titik pada deret harian yang selalu diambil (komponen boleh memotongnya). */
export const DASHBOARD_DAILY_POINTS = 30;

/** Batas baris yang ditampilkan per kelompok Action List (bukan batas hitungan). */
export const ACTION_PREVIEW_LIMIT = 5;

/** PostgREST membatasi panjang URL — daftar id dipecah agar `.in()` tidak kepanjangan. */
export const ID_CHUNK_SIZE = 150;

// ── Tipe publik ──────────────────────────────────────────────────────────────

export interface PeriodStats {
  /** Omzet bersih (penjualan dikurangi retur) dalam Rupiah. */
  revenue: number;
  /** Jumlah transaksi penjualan (baris retur tidak dihitung). */
  transactionCount: number;
  /** Total item terjual bersih = SUM(qty - returned_qty). */
  itemsSold: number;
  /** Rata-rata nilai per transaksi. 0 kalau belum ada transaksi. */
  averageTicket: number;
}

export interface DailyPoint {
  /** Tanggal kunci `YYYY-MM-DD` (waktu lokal, bukan UTC). */
  date: string;
  /** Label pendek untuk sumbu X, mis. "17 Sep". */
  label: string;
  revenue: number;
  transactionCount: number;
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  /** Nilai penjualan bersih kategori ini (Rupiah). */
  value: number;
}

export type ActionKind = "low_stock" | "due_receivable" | "open_shift";

/** Tingkat urgensi — dipetakan ke warna teks di komponen (teal/mustard/coral). */
export type ActionSeverity = "info" | "warning" | "danger";

export interface ActionEntry {
  /** Judul baris, mis. nama produk atau nomor struk. */
  title: string;
  /** Keterangan pendek, mis. "Sisa 2 dari minimal 10". */
  detail: string;
}

export interface ActionGroup {
  kind: ActionKind;
  title: string;
  /** Jumlah TOTAL yang perlu perhatian (bisa lebih besar dari `entries.length`). */
  count: number;
  severity: ActionSeverity;
  /** Maksimal 5 baris contoh untuk ditampilkan. */
  entries: ActionEntry[];
  /** Key menu tujuan saat baris diklik — harus cocok dengan `activeMenu` di app/page.tsx. */
  targetMenu: "stok" | "riwayat" | "kas";
}

// ── Bentuk baris mentah dari Supabase ────────────────────────────────────────

export interface RawTransaction {
  id: string;
  total: number | null;
  status: string;
  created_at: string;
  related_transaction_id: string | null;
}

export interface RawItem {
  transaction_id: string;
  product_id: string | null;
  qty: number | null;
  returned_qty: number | null;
  unit_price: number | null;
  subtotal: number | null;
}

export interface RawLowStockProduct {
  id: string;
  name: string;
  stock: number | null;
  min_stock: number | null;
  unit: string | null;
}

export interface RawReceivablePayment {
  id: string;
  transaction_id: string;
  amount: number | null;
  due_date: string;
}

export interface ReceivableTrxInfo {
  receipt_no: string;
  customer_name: string | null;
  status: string;
}

export interface RawOpenShift {
  id: string;
  cashier_id: string;
  opened_at: string;
  opening_cash: number | null;
}

// ── Statistik penjualan ──────────────────────────────────────────────────────

export function emptyStats(): PeriodStats {
  return { revenue: 0, transactionCount: 0, itemsSold: 0, averageTicket: 0 };
}

export interface DashboardWindow {
  todayStart: Date;
  monthStart: Date;
  /** Awal grafik harian (DASHBOARD_DAILY_POINTS hari termasuk hari ini). */
  chartStart: Date;
  /** Batas paling awal data yang perlu ditarik (min dari awal bulan & chartStart). */
  windowStart: Date;
}

/**
 * Jendela waktu dashboard. Jendela tarik data = yang paling awal antara awal
 * bulan dan 30 hari lalu, supaya cukup satu query untuk stat bulan DAN grafik.
 */
export function getDashboardWindow(now: Date): DashboardWindow {
  const todayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartStart = addDays(todayStart, -(DASHBOARD_DAILY_POINTS - 1));
  const windowStart = monthStart < chartStart ? monthStart : chartStart;
  return { todayStart, monthStart, chartStart, windowStart };
}

export interface DashboardSalesInput {
  transactions: RawTransaction[];
  items: RawItem[];
  /** product_id -> category_id (null = produk tanpa kategori). */
  categoryIdByProduct: Map<string, string | null>;
  /** category_id -> nama. */
  categoryMeta: Map<string, { name: string }>;
  now: Date;
}

export interface DashboardSales {
  today: PeriodStats;
  month: PeriodStats;
  daily: DailyPoint[];
  categories: CategorySlice[];
}

/** Agregasi penjualan untuk stat hari ini, bulan berjalan, deret harian, dan pie kategori. */
export function aggregateDashboardSales({
  transactions,
  items,
  categoryIdByProduct,
  categoryMeta,
  now,
}: DashboardSalesInput): DashboardSales {
  const { todayStart, monthStart, chartStart } = getDashboardWindow(now);

  // Peta transaksi → tanggal, dipakai saat menjumlahkan item per periode.
  const trxDate = new Map<string, Date>();
  for (const trx of transactions) {
    trxDate.set(trx.id, new Date(trx.created_at));
  }

  // Deret harian (selalu DASHBOARD_DAILY_POINTS titik, termasuk hari yang nol
  // transaksi — titik kosong penting supaya bentuk grafik tidak menipu).
  const dailyMap = new Map<string, DailyPoint>();
  for (let i = 0; i < DASHBOARD_DAILY_POINTS; i += 1) {
    const date = addDays(chartStart, i);
    dailyMap.set(dateKey(date), {
      date: dateKey(date),
      label: shortLabel(date),
      revenue: 0,
      transactionCount: 0,
    });
  }

  const todayAcc = emptyStats();
  const monthAcc = emptyStats();

  for (const trx of transactions) {
    const createdAt = new Date(trx.created_at);
    const total = Number(trx.total ?? 0);
    const isSale = trx.related_transaction_id === null;

    // Grafik harian: omzet bersih (retur ikut, nilainya negatif), tapi hitungan
    // transaksi hanya baris penjualan.
    const point = dailyMap.get(dateKey(createdAt));
    if (point) {
      point.revenue += total;
      if (isSale) point.transactionCount += 1;
    }

    if (createdAt >= monthStart) {
      monthAcc.revenue += total;
      if (isSale) monthAcc.transactionCount += 1;
    }

    if (createdAt >= todayStart) {
      todayAcc.revenue += total;
      if (isSale) todayAcc.transactionCount += 1;
    }
  }

  // Item terjual + komposisi kategori (kategori dihitung untuk rentang 30 hari,
  // sama dengan grafik, supaya pie dan bar bercerita tentang periode yang sama).
  const categoryValue = new Map<string | null, number>();

  for (const item of items) {
    const createdAt = trxDate.get(item.transaction_id);
    if (!createdAt) continue;

    const netQty = Number(item.qty ?? 0) - Number(item.returned_qty ?? 0);
    if (netQty <= 0) continue;

    if (createdAt >= monthStart) monthAcc.itemsSold += netQty;
    if (createdAt >= todayStart) todayAcc.itemsSold += netQty;

    if (createdAt >= chartStart) {
      // Nilai kategori dihitung ulang dari `unit_price × netQty`, BUKAN dari
      // `subtotal` apa adanya — subtotal masih memuat qty penuh sebelum retur.
      const value = Number(item.unit_price ?? 0) * netQty;
      const categoryId = item.product_id
        ? (categoryIdByProduct.get(item.product_id) ?? null)
        : null;
      categoryValue.set(categoryId, (categoryValue.get(categoryId) ?? 0) + value);
    }
  }

  todayAcc.averageTicket =
    todayAcc.transactionCount > 0
      ? Math.round(todayAcc.revenue / todayAcc.transactionCount)
      : 0;
  monthAcc.averageTicket =
    monthAcc.transactionCount > 0
      ? Math.round(monthAcc.revenue / monthAcc.transactionCount)
      : 0;

  const categories: CategorySlice[] = Array.from(categoryValue.entries())
    .filter(([, value]) => value > 0)
    .map(([categoryId, value]) => {
      const meta = categoryId ? categoryMeta.get(categoryId) : undefined;
      return {
        categoryId,
        name: meta?.name ?? "Tanpa Kategori",
        value,
      };
    })
    .sort((a, b) => b.value - a.value);

  return {
    today: todayAcc,
    month: monthAcc,
    daily: Array.from(dailyMap.values()),
    categories,
  };
}

// ── Action List ──────────────────────────────────────────────────────────────

/**
 * Kelompok "Stok menipis". Menerima produk apa adanya dari query (yang sudah
 * dibatasi `min_stock > 0`); penyaringan `stock <= min_stock` dilakukan di
 * sini karena PostgREST tidak bisa membandingkan dua kolom.
 */
export function buildLowStockGroup(
  products: RawLowStockProduct[],
): ActionGroup | null {
  const rows = products.filter(
    (row) => Number(row.stock ?? 0) <= Number(row.min_stock ?? 0),
  );

  if (rows.length === 0) return null;

  const habis = rows.some((row) => Number(row.stock ?? 0) <= 0);

  return {
    kind: "low_stock",
    title: "Stok menipis",
    count: rows.length,
    // Ada yang sudah benar-benar habis → bahaya, selebihnya peringatan.
    severity: habis ? "danger" : "warning",
    targetMenu: "stok",
    entries: rows.slice(0, ACTION_PREVIEW_LIMIT).map((row) => {
      const stock = Number(row.stock ?? 0);
      const unit = row.unit ? ` ${row.unit}` : "";
      return {
        title: row.name,
        detail:
          stock <= 0
            ? `Habis — minimal ${row.min_stock}${unit}`
            : `Sisa ${stock}${unit} dari minimal ${row.min_stock}${unit}`,
      };
    }),
  };
}

/**
 * Kelompok "Piutang jatuh tempo". `payments` = pembayaran TEMPO yang jatuh
 * tempo hari ini atau lebih awal; `trxInfo` = identitas transaksinya.
 * Pembayaran tanpa transaksi (atau transaksinya VOID) dibuang.
 */
export function buildReceivablesGroup(
  payments: RawReceivablePayment[],
  trxInfo: Map<string, ReceivableTrxInfo>,
  todayStart: Date,
): ActionGroup | null {
  const dueKey = dateKey(todayStart);

  const rows = payments.filter((payment) => {
    const info = trxInfo.get(payment.transaction_id);
    return !!info && info.status !== "VOID";
  });

  if (rows.length === 0) return null;

  const lewatTempo = rows.some((payment) => payment.due_date < dueKey);

  return {
    kind: "due_receivable",
    title: "Piutang jatuh tempo",
    count: rows.length,
    severity: lewatTempo ? "danger" : "warning",
    targetMenu: "riwayat",
    entries: rows.slice(0, ACTION_PREVIEW_LIMIT).map((payment) => {
      const info = trxInfo.get(payment.transaction_id);
      const nama = info?.customer_name?.trim() || "Tanpa nama";
      const jatuhTempo = new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
      }).format(new Date(`${payment.due_date}T00:00:00`));

      return {
        title: `${nama} — ${info?.receipt_no ?? "?"}`,
        detail:
          payment.due_date < dueKey
            ? `Lewat tempo sejak ${jatuhTempo}`
            : `Jatuh tempo hari ini (${jatuhTempo})`,
      };
    }),
  };
}

/**
 * Kelompok "Shift belum ditutup" — shift OPEN yang dibuka SEBELUM hari ini.
 * `nameById` = id kasir → nama (dari `profiles_directory`).
 */
export function buildStaleShiftsGroup(
  shifts: RawOpenShift[],
  nameById: Map<string, string>,
): ActionGroup | null {
  if (shifts.length === 0) return null;

  return {
    kind: "open_shift",
    title: "Shift belum ditutup",
    count: shifts.length,
    severity: "danger",
    targetMenu: "kas",
    entries: shifts.slice(0, ACTION_PREVIEW_LIMIT).map((row) => {
      const dibuka = new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(row.opened_at));

      return {
        title: nameById.get(row.cashier_id) ?? "Kasir tidak dikenal",
        detail: `Dibuka ${dibuka}, masih terbuka`,
      };
    }),
  };
}
