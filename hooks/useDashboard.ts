// hooks/useDashboard.ts
// ── TAMBAHAN (T-06) ── Hook domain Dashboard (PRD §17 T-06 + §4.8). Menyediakan
// SEMUA agregat yang dipakai app/components/dashboard/DashboardModule.tsx:
//   - stat hari ini & bulan berjalan (omzet, transaksi, item terjual, rata-rata)
//   - deret harian 30 hari terakhir (untuk bar chart 7/30 hari — lihat catatan di bawah)
//   - komposisi kategori terlaris 30 hari (untuk pie chart)
//   - Action List: stok menipis, piutang tempo jatuh tempo, shift belum ditutup
//
// ═══════════════════════════════════════════════════════════════════════════════
// KEPUTUSAN PENTING — WAJIB DIBACA SEBELUM MENGUBAH FILE INI
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. OMZET = SUM(total) DARI STATUS 'PAID' **DAN** 'RETURN' (VOID dibuang).
//    Kenapa bukan cuma 'PAID'? Karena RPC `return_transaction` (migration 004)
//    melakukan DUA hal sekaligus:
//      a. membuat baris transaksi BARU berstatus 'RETURN' dengan `total` NEGATIF
//         (`-v_refund_total`), dan
//      b. mengubah status transaksi ASLI dari 'PAID' menjadi 'RETURN' juga —
//         bahkan untuk retur SEBAGIAN.
//    Jadi kalau difilter `status = 'PAID'` saja, satu retur sebagian akan
//    menghapus SELURUH omzet transaksi aslinya dari laporan. Dengan menjumlahkan
//    kedua status, hasilnya otomatis omzet BERSIH: nilai asli (positif) dikurangi
//    refund (negatif). VOID tetap dibuang total karena transaksinya dibatalkan
//    penuh dan stoknya sudah dikembalikan.
//
// 2. JUMLAH TRANSAKSI hanya menghitung baris PENJUALAN, bukan baris retur.
//    Pembedanya `related_transaction_id`: baris retur selalu terisi (menunjuk ke
//    transaksi asli), baris penjualan selalu NULL. Kalau retur ikut dihitung,
//    satu penjualan yang diretur akan tampil sebagai 2 transaksi.
//
// 3. ITEM TERJUAL dihitung `qty - returned_qty` dari `transaction_items` milik
//    transaksi ASLI. Baris transaksi retur sendiri memang TIDAK punya item sama
//    sekali (bug yang sudah tercatat di PROGRESS.md, belum diperbaiki atas
//    keputusan pemilik project) — jadi jangan pernah menjumlahkan item dari baris
//    retur, tidak akan ada isinya. Konsekuensi jujur yang perlu diketahui:
//    `returned_qty` menempel pada item transaksi ASLI, sehingga retur yang terjadi
//    HARI INI atas transaksi KEMARIN akan mengurangi angka "item terjual" di
//    tanggal kemarin, bukan hari ini. Untuk laporan harian ini masih wajar;
//    kalau nanti T-08 butuh pemisahan tanggal retur, sumbernya `stock_movements`
//    (type 'return'), bukan `transaction_items`.
//
// 4. TIDAK PAKAI RPC/VIEW AGREGAT DI DATABASE. Semua agregasi dilakukan di sini
//    setelah data mentah ditarik. Alasannya: (a) volume data satu toko dalam 30
//    hari masih kecil, (b) menghindari menambah objek DB baru yang harus diurus
//    RLS-nya untuk sesuatu yang sifatnya cuma tampilan, (c) Aturan Main #5 PRD
//    (logika uang wajib server-side) berlaku untuk uang yang DITULIS/DIKUNCI
//    (mis. `expected_cash` di `close_shift`), bukan untuk ringkasan read-only
//    yang tidak dipakai sebagai dasar transaksi apa pun.
//    KALAU nanti data sudah puluhan ribu baris per bulan, pindahkan agregasi ke
//    RPC `security definer` — bentuk return-nya sengaja dibuat datar supaya
//    penggantian itu tidak menyentuh komponen.
//
// 5. CHART 7/30 HARI TIDAK MEMICU FETCH ULANG. Hook selalu mengembalikan 30 titik
//    harian; tombol "7 Hari / 30 Hari" di komponen cukup memotong array (slice)
//    di sisi client. Ini sengaja — supaya ganti rentang terasa instan dan tidak
//    membebani database untuk data yang sudah ada di memori.
//
// 6. PIUTANG: belum ada mekanisme PELUNASAN tempo di sistem (itu scope T-08,
//    sub-tab Piutang/Tempo). Artinya SEMUA pembayaran `TEMPO` masih dianggap
//    belum lunas di sini. Ini bukan kelalaian — memang belum ada kolom/tabel
//    penanda lunas. Saat T-08 menambahkannya, filter tinggal ditambah di bagian
//    `loadReceivables()` di bawah.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBranchScope } from "@/hooks/useActiveBranch";
import { branchFilter } from "@/lib/pos/branches";
import { chunk, dateKey } from "@/lib/pos/dateRange";
// ── Logika hitung dipindahkan ke lib/pos/dashboardLogic.ts (fungsi murni, ada
// testnya). Hook ini hanya mengambil data dari Supabase lalu menyerahkannya ke
// sana. Tipe & konstanta di-ekspor ulang supaya import lama tetap jalan.
import {
  DASHBOARD_DAILY_POINTS,
  ID_CHUNK_SIZE,
  aggregateDashboardSales,
  buildLowStockGroup,
  buildReceivablesGroup,
  buildStaleShiftsGroup,
  emptyStats,
  getDashboardWindow,
  type ActionGroup,
  type CategorySlice,
  type DailyPoint,
  type PeriodStats,
  type RawItem,
  type RawLowStockProduct,
  type RawOpenShift,
  type RawReceivablePayment,
  type RawTransaction,
  type ReceivableTrxInfo,
} from "@/lib/pos/dashboardLogic";

export { DASHBOARD_DAILY_POINTS };
export type {
  ActionEntry,
  ActionGroup,
  ActionKind,
  ActionSeverity,
  CategorySlice,
  DailyPoint,
  PeriodStats,
} from "@/lib/pos/dashboardLogic";

const supabase = createClient();

interface RawProductLite {
  id: string;
  category_id: string | null;
}

interface UseDashboardResult {
  today: PeriodStats;
  month: PeriodStats;
  daily: DailyPoint[];
  categories: CategorySlice[];
  actions: ActionGroup[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Waktu selesai pemuatan terakhir — dipakai label "diperbarui pukul ...". */
  lastUpdatedAt: Date | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboard(): UseDashboardResult {
  const [today, setToday] = useState<PeriodStats>(emptyStats);
  const [month, setMonth] = useState<PeriodStats>(emptyStats);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [categories, setCategories] = useState<CategorySlice[]>([]);
  const [actions, setActions] = useState<ActionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);
  // ── TAMBAHAN (migration 047) ── Statistik penjualan & shift untuk cabang terpilih.
  const { branchId, ready } = useBranchScope();

  useEffect(() => {
    if (!ready) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const now = new Date();
      const { todayStart, windowStart } = getDashboardWindow(now);

      try {
        // ── 1. Transaksi dalam jendela ──────────────────────────────────────
        // VOID sengaja tidak diambil sama sekali (lihat keputusan #1 di header).
        const { data: trxData, error: trxError } = await supabase
          .from("transactions")
          .select("id, total, status, created_at, related_transaction_id")
          .match(branchFilter(branchId))
          .in("status", ["PAID", "RETURN"])
          .is("deleted_at", null)
          .gte("created_at", windowStart.toISOString())
          .order("created_at", { ascending: true });

        if (trxError) throw new Error(trxError.message);

        const transactions = (trxData ?? []) as RawTransaction[];

        // ── 2. Item dari transaksi di atas ──────────────────────────────────
        // Hanya transaksi PENJUALAN yang punya item (baris retur tidak punya —
        // lihat keputusan #3). Jadi id yang ditanyakan dipersempit dulu supaya
        // payload tidak membawa id yang pasti tidak ada isinya.
        const saleIds = transactions
          .filter((trx) => trx.related_transaction_id === null)
          .map((trx) => trx.id);

        const items: RawItem[] = [];

        for (const ids of chunk(saleIds, ID_CHUNK_SIZE)) {
          const { data: itemData, error: itemError } = await supabase
            .from("transaction_items")
            .select(
              "transaction_id, product_id, qty, returned_qty, unit_price, subtotal",
            )
            .in("transaction_id", ids);

          if (itemError) throw new Error(itemError.message);
          items.push(...((itemData ?? []) as RawItem[]));
        }

        // ── 3. Peta produk → kategori, dan kategori → nama/warna ────────────
        // Sengaja query terpisah, BUKAN embed PostgREST bertingkat
        // (`product:products(category:categories(...))`). Alasan yang sama seperti
        // di hooks/useStock.ts: bentuk FK di database ini tidak seragam antara
        // jalur scripts/setup-database.sql dan rantai migration, sehingga embed
        // berisiko patah diam-diam di salah satu jalur. Dua query kecil jauh lebih
        // mudah ditebak perilakunya.
        const productIds = Array.from(
          new Set(
            items
              .map((item) => item.product_id)
              .filter((id): id is string => !!id),
          ),
        );

        const categoryIdByProduct = new Map<string, string | null>();

        for (const ids of chunk(productIds, ID_CHUNK_SIZE)) {
          const { data: productData, error: productError } = await supabase
            .from("products")
            .select("id, category_id")
            .in("id", ids);

          if (productError) throw new Error(productError.message);

          for (const product of (productData ?? []) as RawProductLite[]) {
            categoryIdByProduct.set(product.id, product.category_id);
          }
        }

        const { data: categoryData, error: categoryError } = await supabase
          .from("categories")
          .select("id, name");

        if (categoryError) throw new Error(categoryError.message);

        const categoryMeta = new Map<string, { name: string }>();
        for (const row of categoryData ?? []) {
          categoryMeta.set(row.id, { name: row.name });
        }

        if (isCancelled) return;

        // ── 4. Agregasi (fungsi murni di lib/pos/dashboardLogic.ts) ─────────
        const sales = aggregateDashboardSales({
          transactions,
          items,
          categoryIdByProduct,
          categoryMeta,
          now,
        });

        // ── 5. Action List ──────────────────────────────────────────────────
        const actionGroups = await loadActionGroups(todayStart, branchId);

        if (isCancelled) return;

        setToday(sales.today);
        setMonth(sales.month);
        setDaily(sales.daily);
        setCategories(sales.categories);
        setActions(actionGroups);
        setLastUpdatedAt(new Date());
        setIsLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error("useDashboard load error:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Gagal memuat ringkasan dashboard.",
        );
        setToday(emptyStats());
        setMonth(emptyStats());
        setDaily([]);
        setCategories([]);
        setActions([]);
        setIsLoading(false);
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken, branchId, ready]);

  // Array/objek hasil agregasi dikembalikan apa adanya; useMemo di sini hanya
  // menjaga identitas objek pembungkus supaya konsumen yang memakainya sebagai
  // dependency effect tidak ikut render berulang tanpa sebab.
  return useMemo(
    () => ({
      today,
      month,
      daily,
      categories,
      actions,
      isLoading,
      error,
      refetch,
      lastUpdatedAt,
    }),
    [today, month, daily, categories, actions, isLoading, error, refetch, lastUpdatedAt],
  );
}

// ── Action List ──────────────────────────────────────────────────────────────
//
// Dipisah jadi fungsi sendiri supaya bagian agregat penjualan di atas tetap
// terbaca. Ketiga kelompok ditarik paralel — tidak saling bergantung.
//
// Catatan RLS yang perlu diingat saat membaca hasilnya:
// - `products` bisa dibaca semua role, jadi "stok menipis" selalu terisi.
// - `shift_sessions` dibatasi RLS (migration 007): kasir hanya melihat shift
//   miliknya sendiri, admin/supervisor melihat semua. Jadi kelompok "shift belum
//   ditutup" otomatis menyesuaikan role TANPA cek role di sini — memang disengaja.
// - `payments` mengikuti akses transaksinya.

async function loadActionGroups(
  todayStart: Date,
  branchId: string | null,
): Promise<ActionGroup[]> {
  const [lowStock, receivables, openShifts] = await Promise.all([
    loadLowStock(),
    loadReceivables(todayStart),
    loadStaleShifts(todayStart, branchId),
  ]);

  // Kelompok kosong dibuang — Action List hanya menampilkan yang benar-benar
  // perlu perhatian, bukan daftar tetap berisi "0 item".
  return [lowStock, receivables, openShifts].filter(
    (group): group is ActionGroup => group !== null,
  );
}

async function loadLowStock(): Promise<ActionGroup | null> {
  // PostgREST tidak bisa membandingkan dua kolom (`stock <= min_stock`) lewat
  // filter biasa, jadi penyaringan akhir dilakukan di sini. Untuk menekan jumlah
  // baris yang ditarik, hanya produk yang PUNYA ambang batas (`min_stock > 0`)
  // yang diambil — produk tanpa ambang memang tidak pernah "menipis".
  // Produk jasa dikecualikan: stoknya tidak bermakna (pola sama dengan T-05).
  const { data, error } = await supabase
    .from("products")
    .select("id, name, stock, min_stock, unit")
    .eq("is_active", true)
    .eq("is_service", false)
    .is("deleted_at", null)
    .gt("min_stock", 0)
    .order("stock", { ascending: true });

  if (error) {
    console.error("Action List (stok menipis) gagal dimuat:", error);
    return null;
  }

  return buildLowStockGroup((data ?? []) as RawLowStockProduct[]);
}

async function loadReceivables(todayStart: Date): Promise<ActionGroup | null> {
  // Semua pembayaran TEMPO yang tanggal jatuh temponya hari ini atau sudah lewat.
  // Belum ada penanda lunas di skema (lihat keputusan #6 di header) — begitu T-08
  // menambahkannya, tambahkan filternya di query ini.
  const dueKey = dateKey(todayStart);

  const { data, error } = await supabase
    .from("payments")
    .select("id, transaction_id, amount, due_date")
    .eq("method", "TEMPO")
    .not("due_date", "is", null)
    .lte("due_date", dueKey)
    .order("due_date", { ascending: true });

  if (error) {
    console.error("Action List (piutang) gagal dimuat:", error);
    return null;
  }

  const payments = (data ?? []) as RawReceivablePayment[];

  if (payments.length === 0) return null;

  // Ambil identitas transaksinya secara terpisah (bukan embed — alasan sama
  // seperti di bagian kategori) sekaligus untuk membuang transaksi VOID.
  const trxIds = Array.from(new Set(payments.map((p) => p.transaction_id)));
  const trxInfo = new Map<string, ReceivableTrxInfo>();

  for (const ids of chunk(trxIds, ID_CHUNK_SIZE)) {
    const { data: trxData, error: trxError } = await supabase
      .from("transactions")
      .select("id, receipt_no, customer_name, status")
      .in("id", ids)
      .is("deleted_at", null);

    if (trxError) {
      console.error("Action List (piutang) gagal memuat transaksi:", trxError);
      return null;
    }

    for (const row of trxData ?? []) {
      trxInfo.set(row.id, {
        receipt_no: row.receipt_no,
        customer_name: row.customer_name,
        status: row.status,
      });
    }
  }

  return buildReceivablesGroup(payments, trxInfo, todayStart);
}

async function loadStaleShifts(
  todayStart: Date,
  branchId: string | null,
): Promise<ActionGroup | null> {
  // Shift yang masih OPEN padahal dibuka SEBELUM hari ini = lupa ditutup.
  // Shift yang dibuka hari ini dan masih terbuka itu normal (kasir sedang kerja),
  // jadi sengaja tidak ikut dihitung.
  const { data, error } = await supabase
    .from("shift_sessions")
    .select("id, cashier_id, opened_at, opening_cash")
    .match(branchFilter(branchId))
    .eq("status", "OPEN")
    .lt("opened_at", todayStart.toISOString())
    .order("opened_at", { ascending: true });

  if (error) {
    console.error("Action List (shift) gagal dimuat:", error);
    return null;
  }

  const rows = (data ?? []) as RawOpenShift[];

  if (rows.length === 0) return null;

  // Nama kasir diambil dari VIEW `profiles_directory` (migration 023),
  // BUKAN dari tabel `profiles` langsung — sejak migration 024, RLS
  // `profiles` cuma mengizinkan SELECT baris milik sendiri untuk role
  // selain admin/supervisor, sedangkan widget ini juga tampil untuk kasir
  // (PRD §5: dashboard "view" ✔ semua role) dan perlu menampilkan nama
  // KASIR LAIN yang shift-nya belum ditutup. `profiles_directory` sengaja
  // cuma expose kolom `id, full_name` user aktif (bukan `role`/`email`/
  // `fcm_token` yang sensitif), jadi aman diakses semua role login.
  const cashierIds = Array.from(new Set(rows.map((row) => row.cashier_id)));
  const nameById = new Map<string, string>();

  if (cashierIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles_directory")
      .select("id, full_name")
      .in("id", cashierIds);

    for (const profile of profiles ?? []) {
      if (profile.full_name) nameById.set(profile.id, profile.full_name);
    }
  }

  return buildStaleShiftsGroup(rows, nameById);
}
