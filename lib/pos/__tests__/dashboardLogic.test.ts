import { describe, expect, it } from "vitest";
import {
  ACTION_PREVIEW_LIMIT,
  DASHBOARD_DAILY_POINTS,
  aggregateDashboardSales,
  buildLowStockGroup,
  buildReceivablesGroup,
  buildStaleShiftsGroup,
  emptyStats,
  getDashboardWindow,
  type RawItem,
  type RawLowStockProduct,
  type RawOpenShift,
  type RawReceivablePayment,
  type RawTransaction,
  type ReceivableTrxInfo,
} from "../dashboardLogic";

// Kamis, 5 Nov 2026 10:30 waktu lokal. Awal bulan = 1 Nov, awal grafik = 7 Okt.
// Tanggal dibuat dengan konstruktor lokal lalu diubah ke ISO, supaya hasilnya
// sama di zona waktu mana pun.
const NOW = new Date(2026, 10, 5, 10, 30, 0, 0);
const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const iso = (y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms).toISOString();

let seq = 0;
const trx = (over: Partial<RawTransaction> = {}): RawTransaction => ({
  id: `t${++seq}`,
  total: 10_000,
  status: "PAID",
  created_at: iso(2026, 11, 5, 9),
  related_transaction_id: null,
  ...over,
});
const item = (over: Partial<RawItem> = {}): RawItem => ({
  transaction_id: "t1",
  product_id: null,
  qty: 1,
  returned_qty: 0,
  unit_price: 1_000,
  subtotal: 1_000,
  ...over,
});

const sales = (
  input: Partial<Parameters<typeof aggregateDashboardSales>[0]> = {},
) =>
  aggregateDashboardSales({
    transactions: [],
    items: [],
    categoryIdByProduct: new Map(),
    categoryMeta: new Map(),
    now: NOW,
    ...input,
  });

describe("emptyStats", () => {
  it("semua nol, dan objek baru tiap dipanggil", () => {
    expect(emptyStats()).toEqual({
      revenue: 0,
      transactionCount: 0,
      itemsSold: 0,
      averageTicket: 0,
    });
    expect(emptyStats()).not.toBe(emptyStats());
  });
});

describe("getDashboardWindow", () => {
  it("5 Nov: grafik mulai lebih awal dari awal bulan -> jendela = awal grafik", () => {
    const w = getDashboardWindow(NOW);
    expect(ymd(w.todayStart)).toEqual([2026, 11, 5]);
    expect(w.todayStart.getHours()).toBe(0);
    expect(ymd(w.monthStart)).toEqual([2026, 11, 1]);
    expect(ymd(w.chartStart)).toEqual([2026, 10, 7]);
    expect(ymd(w.windowStart)).toEqual([2026, 10, 7]);
  });

  it("31 Des: awal bulan (1 Des) lebih awal dari awal grafik (2 Des) -> jendela = awal bulan", () => {
    const w = getDashboardWindow(new Date(2026, 11, 31, 20));
    expect(ymd(w.chartStart)).toEqual([2026, 12, 2]);
    expect(ymd(w.windowStart)).toEqual([2026, 12, 1]);
  });

  it("30 Nov: awal grafik = awal bulan = 1 Nov -> jendela 1 Nov", () => {
    const w = getDashboardWindow(new Date(2026, 10, 30, 8));
    expect(ymd(w.chartStart)).toEqual([2026, 11, 1]);
    expect(ymd(w.windowStart)).toEqual([2026, 11, 1]);
  });

  it("memakai konstanta jumlah titik grafik", () => {
    expect(DASHBOARD_DAILY_POINTS).toBe(30);
  });
});

describe("aggregateDashboardSales - deret harian", () => {
  it("tanpa transaksi: 30 titik nol dari 7 Okt sampai hari ini, kategori kosong", () => {
    const r = sales();
    expect(r.daily).toHaveLength(DASHBOARD_DAILY_POINTS);
    expect(r.daily[0].date).toBe("2026-10-07");
    expect(r.daily[0].label).toBe("7 Okt");
    expect(r.daily[29].date).toBe("2026-11-05");
    expect(r.daily[29].label).toBe("5 Nov");
    expect(r.daily.every((p) => p.revenue === 0 && p.transactionCount === 0)).toBe(
      true,
    );
    expect(r.categories).toEqual([]);
    expect(r.today).toEqual(emptyStats());
    expect(r.month).toEqual(emptyStats());
  });

  it("tanggal berurutan tanpa lompat/duplikat melewati 31 Okt -> 1 Nov", () => {
    const keys = sales().daily.map((p) => p.date);
    expect(new Set(keys).size).toBe(30);
    expect(keys[24]).toBe("2026-10-31");
    expect(keys[25]).toBe("2026-11-01");
  });

  it("transaksi masuk ke titik tanggal lokalnya", () => {
    const r = sales({
      transactions: [
        trx({ total: 10_000, created_at: iso(2026, 11, 4, 23, 59, 59, 999) }),
        trx({ total: 5_000, created_at: iso(2026, 11, 5, 0, 0, 0, 0) }),
      ],
    });
    const nov4 = r.daily.find((p) => p.date === "2026-11-04")!;
    const nov5 = r.daily.find((p) => p.date === "2026-11-05")!;
    expect(nov4).toMatchObject({ revenue: 10_000, transactionCount: 1 });
    expect(nov5).toMatchObject({ revenue: 5_000, transactionCount: 1 });
  });

  it("jam 00:30 dihitung di tanggal itu (bukan kemarin versi UTC)", () => {
    const r = sales({
      transactions: [trx({ total: 7_000, created_at: iso(2026, 11, 5, 0, 30) })],
    });
    expect(r.daily.find((p) => p.date === "2026-11-05")!.revenue).toBe(7_000);
    expect(r.daily.find((p) => p.date === "2026-11-04")!.revenue).toBe(0);
  });

  it("transaksi sebelum awal grafik tidak membuat titik baru dan tidak ikut stat", () => {
    const r = sales({
      transactions: [trx({ total: 99_000, created_at: iso(2026, 10, 6, 12) })],
    });
    expect(r.daily).toHaveLength(30);
    expect(r.daily.reduce((s, p) => s + p.revenue, 0)).toBe(0);
    expect(r.month.revenue).toBe(0);
  });
});

describe("aggregateDashboardSales - omzet, retur, dan jumlah transaksi", () => {
  it("retur sebagian: omzet bersih = nilai asli + baris retur negatif; jumlah transaksi tetap 1", () => {
    // Pola RPC return_transaction: transaksi asli berstatus RETURN (total tetap
    // positif) + satu baris baru RETURN bertotal negatif yang menunjuk ke asal.
    const original = trx({
      id: "A",
      total: 100_000,
      status: "RETURN",
      related_transaction_id: null,
    });
    const refund = trx({
      id: "R",
      total: -30_000,
      status: "RETURN",
      related_transaction_id: "A",
    });
    const r = sales({ transactions: [original, refund] });
    expect(r.today.revenue).toBe(70_000);
    expect(r.today.transactionCount).toBe(1);
    expect(r.month.revenue).toBe(70_000);
    expect(r.month.transactionCount).toBe(1);
    const point = r.daily.find((p) => p.date === "2026-11-05")!;
    expect(point).toMatchObject({ revenue: 70_000, transactionCount: 1 });
  });

  it("hari yang hanya berisi retur: omzet negatif, transaksi 0, rata-rata 0", () => {
    const r = sales({
      transactions: [
        trx({ id: "R", total: -20_000, related_transaction_id: "lama" }),
      ],
    });
    expect(r.today).toMatchObject({
      revenue: -20_000,
      transactionCount: 0,
      averageTicket: 0,
    });
  });

  it("total null dihitung 0", () => {
    const r = sales({ transactions: [trx({ total: null })] });
    expect(r.today).toMatchObject({ revenue: 0, transactionCount: 1 });
  });

  it("rata-rata per transaksi dibulatkan (10000,5 -> 10001)", () => {
    const r = sales({
      transactions: [trx({ total: 10_000 }), trx({ total: 10_001 })],
    });
    expect(r.today.averageTicket).toBe(10_001);
    expect(r.month.averageTicket).toBe(10_001);
  });

  it("hari ini vs bulan ini vs sebelum bulan: batas tepat 00:00 hari ini dan 1 Nov", () => {
    const r = sales({
      transactions: [
        trx({ total: 1_000, created_at: iso(2026, 10, 31, 23, 59, 59, 999) }), // sebelum bulan
        trx({ total: 2_000, created_at: iso(2026, 11, 1, 0, 0, 0, 0) }), // awal bulan
        trx({ total: 4_000, created_at: iso(2026, 11, 4, 23, 59, 59, 999) }), // kemarin
        trx({ total: 8_000, created_at: iso(2026, 11, 5, 0, 0, 0, 0) }), // awal hari ini
      ],
    });
    expect(r.today).toMatchObject({ revenue: 8_000, transactionCount: 1 });
    expect(r.month).toMatchObject({ revenue: 14_000, transactionCount: 3 });
    // 31 Okt tetap muncul di grafik 30 hari
    expect(r.daily.find((p) => p.date === "2026-10-31")!.revenue).toBe(1_000);
  });
});

describe("aggregateDashboardSales - item terjual", () => {
  it("netto = qty - returned_qty, dijumlah per periode", () => {
    const a = trx({ id: "A", created_at: iso(2026, 11, 5, 9) });
    const b = trx({ id: "B", created_at: iso(2026, 11, 2, 9) });
    const c = trx({ id: "C", created_at: iso(2026, 10, 20, 9) });
    const r = sales({
      transactions: [a, b, c],
      items: [
        item({ transaction_id: "A", qty: 5, returned_qty: 2 }), // 3 hari ini
        item({ transaction_id: "B", qty: 4, returned_qty: 0 }), // 4 bulan ini
        item({ transaction_id: "C", qty: 10, returned_qty: 0 }), // sebelum bulan
      ],
    });
    expect(r.today.itemsSold).toBe(3);
    expect(r.month.itemsSold).toBe(7);
  });

  it("batas periode untuk item: tepat 1 Nov 00:00 masuk bulan ini; tepat 00:00 hari ini masuk hari ini", () => {
    const r = sales({
      transactions: [
        trx({ id: "A", created_at: iso(2026, 10, 31, 23, 59, 59, 999) }),
        trx({ id: "B", created_at: iso(2026, 11, 1, 0, 0, 0, 0) }),
        trx({ id: "C", created_at: iso(2026, 11, 5, 0, 0, 0, 0) }),
      ],
      items: [
        item({ transaction_id: "A", qty: 1 }),
        item({ transaction_id: "B", qty: 10 }),
        item({ transaction_id: "C", qty: 100 }),
      ],
    });
    expect(r.month.itemsSold).toBe(110);
    expect(r.today.itemsSold).toBe(100);
  });

  it("netto 0 atau negatif diabaikan (retur penuh / data aneh)", () => {
    const a = trx({ id: "A" });
    const r = sales({
      transactions: [a],
      items: [
        item({ transaction_id: "A", qty: 3, returned_qty: 3 }),
        item({ transaction_id: "A", qty: 2, returned_qty: 5 }),
        item({ transaction_id: "A", qty: 1, returned_qty: 0 }),
      ],
    });
    expect(r.today.itemsSold).toBe(1);
  });

  it("qty/returned_qty null dianggap 0", () => {
    const a = trx({ id: "A" });
    const r = sales({
      transactions: [a],
      items: [
        item({ transaction_id: "A", qty: null, returned_qty: null }),
        item({ transaction_id: "A", qty: 2, returned_qty: null }),
      ],
    });
    expect(r.today.itemsSold).toBe(2);
  });

  it("item milik transaksi yang tidak ada dalam daftar diabaikan", () => {
    const r = sales({
      transactions: [trx({ id: "A" })],
      items: [item({ transaction_id: "tidak-ada", qty: 9 })],
    });
    expect(r.today.itemsSold).toBe(0);
  });
});

describe("aggregateDashboardSales - komposisi kategori", () => {
  const catMeta = new Map([
    ["c-makan", { name: "Makanan" }],
    ["c-minum", { name: "Minuman" }],
  ]);
  const catByProduct = new Map<string, string | null>([
    ["p1", "c-makan"],
    ["p2", "c-minum"],
    ["p3", null],
    ["p4", "c-hilang"],
  ]);

  it("nilai = unit_price x qty netto (BUKAN subtotal), diurutkan terbesar dulu", () => {
    const r = sales({
      transactions: [trx({ id: "A" })],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        // subtotal masih memuat qty penuh (5 x 2000), tapi 2 sudah diretur
        item({
          transaction_id: "A",
          product_id: "p1",
          qty: 5,
          returned_qty: 2,
          unit_price: 2_000,
          subtotal: 10_000,
        }),
        item({
          transaction_id: "A",
          product_id: "p2",
          qty: 4,
          unit_price: 5_000,
          subtotal: 20_000,
        }),
      ],
    });
    expect(r.categories).toEqual([
      { categoryId: "c-minum", name: "Minuman", value: 20_000 },
      { categoryId: "c-makan", name: "Makanan", value: 6_000 },
    ]);
  });

  it("nilai kategori dijumlah dari beberapa produk/transaksi", () => {
    const r = sales({
      transactions: [trx({ id: "A" }), trx({ id: "B" })],
      categoryMeta: catMeta,
      categoryIdByProduct: new Map([
        ["p1", "c-makan"],
        ["p5", "c-makan"],
      ]),
      items: [
        item({ transaction_id: "A", product_id: "p1", qty: 1, unit_price: 3_000 }),
        item({ transaction_id: "B", product_id: "p5", qty: 2, unit_price: 1_500 }),
      ],
    });
    expect(r.categories).toEqual([
      { categoryId: "c-makan", name: "Makanan", value: 6_000 },
    ]);
  });

  it("tanpa product_id / produk tanpa kategori -> 'Tanpa Kategori' (categoryId null)", () => {
    const r = sales({
      transactions: [trx({ id: "A" })],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        item({ transaction_id: "A", product_id: null, qty: 1, unit_price: 1_000 }),
        item({ transaction_id: "A", product_id: "p3", qty: 1, unit_price: 2_000 }),
        item({ transaction_id: "A", product_id: "tak-dikenal", qty: 1, unit_price: 500 }),
      ],
    });
    expect(r.categories).toEqual([
      { categoryId: null, name: "Tanpa Kategori", value: 3_500 },
    ]);
  });

  it("kategori yang id-nya tidak ada di daftar kategori: nama 'Tanpa Kategori', id tetap", () => {
    const r = sales({
      transactions: [trx({ id: "A" })],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        item({ transaction_id: "A", product_id: "p4", qty: 2, unit_price: 1_000 }),
      ],
    });
    expect(r.categories).toEqual([
      { categoryId: "c-hilang", name: "Tanpa Kategori", value: 2_000 },
    ]);
  });

  it("kategori bernilai 0 (harga 0 atau retur penuh) dibuang dari pie", () => {
    const r = sales({
      transactions: [trx({ id: "A" })],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        item({ transaction_id: "A", product_id: "p1", qty: 3, unit_price: 0 }),
        item({ transaction_id: "A", product_id: "p2", qty: 2, returned_qty: 2, unit_price: 9_000 }),
      ],
    });
    expect(r.categories).toEqual([]);
  });

  it("unit_price null dianggap 0", () => {
    const r = sales({
      transactions: [trx({ id: "A" })],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        item({ transaction_id: "A", product_id: "p1", qty: 3, unit_price: null }),
      ],
    });
    expect(r.categories).toEqual([]);
  });

  it("pie hanya untuk jendela 30 hari: transaksi sebelum 7 Okt tidak masuk", () => {
    const r = sales({
      transactions: [
        trx({ id: "lama", created_at: iso(2026, 10, 6, 12) }),
        trx({ id: "baru", created_at: iso(2026, 10, 7, 0, 0, 0, 0) }),
      ],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        item({ transaction_id: "lama", product_id: "p1", qty: 1, unit_price: 8_000 }),
        item({ transaction_id: "baru", product_id: "p2", qty: 1, unit_price: 3_000 }),
      ],
    });
    expect(r.categories).toEqual([
      { categoryId: "c-minum", name: "Minuman", value: 3_000 },
    ]);
  });

  it("pie mencakup 30 hari, bukan hanya bulan berjalan", () => {
    const r = sales({
      transactions: [trx({ id: "A", created_at: iso(2026, 10, 15, 12) })],
      categoryMeta: catMeta,
      categoryIdByProduct: catByProduct,
      items: [
        item({ transaction_id: "A", product_id: "p1", qty: 2, unit_price: 1_000 }),
      ],
    });
    expect(r.categories).toHaveLength(1);
    expect(r.month.itemsSold).toBe(0);
  });
});

// ── Action List ──────────────────────────────────────────────────────────────

const prod = (over: Partial<RawLowStockProduct> = {}): RawLowStockProduct => ({
  id: "p",
  name: "Produk",
  stock: 5,
  min_stock: 10,
  unit: "pcs",
  ...over,
});

describe("buildLowStockGroup", () => {
  it("tanpa produk -> null", () => {
    expect(buildLowStockGroup([])).toBeNull();
  });

  it("semua stok di atas minimum -> null", () => {
    expect(
      buildLowStockGroup([prod({ stock: 11, min_stock: 10 }), prod({ stock: 50 })]),
    ).toBeNull();
  });

  it("stok TEPAT sama dengan minimum ikut dianggap menipis", () => {
    const g = buildLowStockGroup([prod({ name: "Gula", stock: 10, min_stock: 10 })])!;
    expect(g.count).toBe(1);
    expect(g.entries[0]).toEqual({
      title: "Gula",
      detail: "Sisa 10 pcs dari minimal 10 pcs",
    });
  });

  it("ada yang menipis tapi belum habis -> warning", () => {
    const g = buildLowStockGroup([prod({ stock: 2 })])!;
    expect(g).toMatchObject({
      kind: "low_stock",
      title: "Stok menipis",
      severity: "warning",
      targetMenu: "stok",
      count: 1,
    });
    expect(g.entries[0].detail).toBe("Sisa 2 pcs dari minimal 10 pcs");
  });

  it("ada yang habis (stok 0) -> danger, detail 'Habis'", () => {
    const g = buildLowStockGroup([
      prod({ name: "A", stock: 3 }),
      prod({ name: "B", stock: 0 }),
    ])!;
    expect(g.severity).toBe("danger");
    expect(g.entries[1].detail).toBe("Habis — minimal 10 pcs");
  });

  it("stok negatif tetap 'Habis' dan danger", () => {
    const g = buildLowStockGroup([prod({ stock: -4 })])!;
    expect(g.severity).toBe("danger");
    expect(g.entries[0].detail).toBe("Habis — minimal 10 pcs");
  });

  it("stok null dianggap 0 (habis)", () => {
    const g = buildLowStockGroup([prod({ stock: null })])!;
    expect(g.severity).toBe("danger");
    expect(g.entries[0].detail).toBe("Habis — minimal 10 pcs");
  });

  it("tanpa satuan: tidak ada spasi sisa", () => {
    const g = buildLowStockGroup([
      prod({ stock: 2, unit: null }),
      prod({ stock: 0, unit: "" }),
    ])!;
    expect(g.entries[0].detail).toBe("Sisa 2 dari minimal 10");
    expect(g.entries[1].detail).toBe("Habis — minimal 10");
  });

  it("produk di atas minimum dibuang, yang menipis dihitung", () => {
    const g = buildLowStockGroup([
      prod({ name: "ok", stock: 99 }),
      prod({ name: "tipis", stock: 1 }),
    ])!;
    expect(g.count).toBe(1);
    expect(g.entries.map((e) => e.title)).toEqual(["tipis"]);
  });

  it(`contoh dibatasi ${ACTION_PREVIEW_LIMIT} baris, count tetap jumlah total, urutan dipertahankan`, () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      prod({ name: `P${i}`, stock: i }),
    );
    const g = buildLowStockGroup(many)!;
    expect(g.count).toBe(8);
    expect(g.entries).toHaveLength(ACTION_PREVIEW_LIMIT);
    expect(g.entries.map((e) => e.title)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });
});

const pay = (over: Partial<RawReceivablePayment> = {}): RawReceivablePayment => ({
  id: "pay1",
  transaction_id: "t1",
  amount: 50_000,
  due_date: "2026-11-05",
  ...over,
});
const info = (over: Partial<ReceivableTrxInfo> = {}): ReceivableTrxInfo => ({
  receipt_no: "INV-001",
  customer_name: "Budi",
  status: "PAID",
  ...over,
});
const TODAY_START = new Date(2026, 10, 5, 0, 0, 0, 0);

describe("buildReceivablesGroup", () => {
  it("tanpa pembayaran -> null", () => {
    expect(buildReceivablesGroup([], new Map(), TODAY_START)).toBeNull();
  });

  it("jatuh tempo HARI INI saja -> warning, detail 'Jatuh tempo hari ini'", () => {
    const g = buildReceivablesGroup(
      [pay({ due_date: "2026-11-05" })],
      new Map([["t1", info()]]),
      TODAY_START,
    )!;
    expect(g).toMatchObject({
      kind: "due_receivable",
      title: "Piutang jatuh tempo",
      severity: "warning",
      targetMenu: "riwayat",
      count: 1,
    });
    expect(g.entries[0].title).toBe("Budi — INV-001");
    expect(g.entries[0].detail).toMatch(/^Jatuh tempo hari ini \(5 Nov 2026\)$/);
  });

  it("sudah lewat tempo -> danger, detail 'Lewat tempo sejak'", () => {
    const g = buildReceivablesGroup(
      [pay({ due_date: "2026-11-01" })],
      new Map([["t1", info()]]),
      TODAY_START,
    )!;
    expect(g.severity).toBe("danger");
    expect(g.entries[0].detail).toMatch(/^Lewat tempo sejak 1 Nov 2026$/);
  });

  it("campuran hari ini + lewat tempo -> danger; detail per baris sesuai tanggalnya", () => {
    const g = buildReceivablesGroup(
      [
        pay({ id: "a", transaction_id: "t1", due_date: "2026-10-30" }),
        pay({ id: "b", transaction_id: "t2", due_date: "2026-11-05" }),
      ],
      new Map([
        ["t1", info()],
        ["t2", info({ receipt_no: "INV-002" })],
      ]),
      TODAY_START,
    )!;
    expect(g.severity).toBe("danger");
    expect(g.entries[0].detail).toContain("Lewat tempo");
    expect(g.entries[1].detail).toContain("hari ini");
  });

  it("transaksi VOID dibuang dari hitungan", () => {
    const g = buildReceivablesGroup(
      [
        pay({ id: "a", transaction_id: "t1" }),
        pay({ id: "b", transaction_id: "t2" }),
      ],
      new Map([
        ["t1", info({ status: "VOID" })],
        ["t2", info({ receipt_no: "INV-002" })],
      ]),
      TODAY_START,
    )!;
    expect(g.count).toBe(1);
    expect(g.entries[0].title).toBe("Budi — INV-002");
  });

  it("pembayaran tanpa transaksi (sudah dihapus) dibuang", () => {
    const g = buildReceivablesGroup(
      [pay({ transaction_id: "hilang" })],
      new Map([["t1", info()]]),
      TODAY_START,
    );
    expect(g).toBeNull();
  });

  it("semua transaksi VOID -> null", () => {
    expect(
      buildReceivablesGroup(
        [pay()],
        new Map([["t1", info({ status: "VOID" })]]),
        TODAY_START,
      ),
    ).toBeNull();
  });

  it("RETURN tidak dibuang (hanya VOID yang dibuang)", () => {
    const g = buildReceivablesGroup(
      [pay()],
      new Map([["t1", info({ status: "RETURN" })]]),
      TODAY_START,
    );
    expect(g?.count).toBe(1);
  });

  it("nama pelanggan dipangkas; kosong/spasi/null -> 'Tanpa nama'", () => {
    const g = buildReceivablesGroup(
      [
        pay({ id: "a", transaction_id: "t1" }),
        pay({ id: "b", transaction_id: "t2" }),
        pay({ id: "c", transaction_id: "t3" }),
      ],
      new Map([
        ["t1", info({ customer_name: "  Sari  " })],
        ["t2", info({ customer_name: "   " })],
        ["t3", info({ customer_name: null })],
      ]),
      TODAY_START,
    )!;
    expect(g.entries.map((e) => e.title)).toEqual([
      "Sari — INV-001",
      "Tanpa nama — INV-001",
      "Tanpa nama — INV-001",
    ]);
  });

  it("contoh dibatasi 5 baris, count = total", () => {
    const payments = Array.from({ length: 7 }, (_, i) =>
      pay({ id: `p${i}`, transaction_id: `t${i}` }),
    );
    const map = new Map(payments.map((p) => [p.transaction_id, info()]));
    const g = buildReceivablesGroup(payments, map, TODAY_START)!;
    expect(g.count).toBe(7);
    expect(g.entries).toHaveLength(5);
  });
});

const shift = (over: Partial<RawOpenShift> = {}): RawOpenShift => ({
  id: "s1",
  cashier_id: "u1",
  opened_at: iso(2026, 11, 4, 22, 30),
  opening_cash: 100_000,
  ...over,
});

describe("buildStaleShiftsGroup", () => {
  it("tanpa shift -> null", () => {
    expect(buildStaleShiftsGroup([], new Map())).toBeNull();
  });

  it("selalu danger, menuju menu kas, memakai nama kasir", () => {
    const g = buildStaleShiftsGroup([shift()], new Map([["u1", "Rina"]]))!;
    expect(g).toMatchObject({
      kind: "open_shift",
      title: "Shift belum ditutup",
      severity: "danger",
      targetMenu: "kas",
      count: 1,
    });
    expect(g.entries[0].title).toBe("Rina");
  });

  it("detail memuat tanggal & jam buka (waktu lokal) dan 'masih terbuka'", () => {
    const g = buildStaleShiftsGroup([shift()], new Map([["u1", "Rina"]]))!;
    expect(g.entries[0].detail).toMatch(/^Dibuka 4 Nov 2026.*22[.:]30, masih terbuka$/);
  });

  it("kasir tidak ada di daftar nama -> 'Kasir tidak dikenal'", () => {
    const g = buildStaleShiftsGroup([shift({ cashier_id: "x" })], new Map())!;
    expect(g.entries[0].title).toBe("Kasir tidak dikenal");
  });

  it("contoh dibatasi 5 baris, count = total, urutan dipertahankan", () => {
    const shifts = Array.from({ length: 7 }, (_, i) =>
      shift({ id: `s${i}`, cashier_id: `u${i}` }),
    );
    const names = new Map(shifts.map((s, i) => [s.cashier_id, `Kasir ${i}`]));
    const g = buildStaleShiftsGroup(shifts, names)!;
    expect(g.count).toBe(7);
    expect(g.entries.map((e) => e.title)).toEqual([
      "Kasir 0",
      "Kasir 1",
      "Kasir 2",
      "Kasir 3",
      "Kasir 4",
    ]);
  });
});
