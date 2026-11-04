import { describe, expect, it } from "vitest";
import {
  buildReceivableRows,
  buildSalesReport,
  buildShiftRows,
  emptySummary,
  receivableStatus,
  type RawPayment,
  type RawSalesItem,
  type RawSalesTransaction,
  type RawShift,
} from "../reportLogic";
import { endOfDay, startOfDay } from "../dateRange";

// Tanggal dibuat dengan konstruktor lokal supaya hasilnya sama di zona waktu
// mana pun (Jakarta, UTC, Los Angeles).
const iso = (y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms).toISOString();
const range = (y1: number, m1: number, d1: number, y2: number, m2: number, d2: number) => ({
  start: startOfDay(new Date(y1, m1 - 1, d1)),
  end: endOfDay(new Date(y2, m2 - 1, d2)),
});

let seq = 0;
const trx = (over: Partial<RawSalesTransaction> = {}): RawSalesTransaction => ({
  id: `t${++seq}`,
  total: 10_000,
  status: "PAID",
  created_at: iso(2026, 11, 5),
  related_transaction_id: null,
  ...over,
});
const item = (over: Partial<RawSalesItem> = {}): RawSalesItem => ({
  transaction_id: "A",
  qty: 1,
  returned_qty: 0,
  ...over,
});

describe("emptySummary", () => {
  it("semua nol, objek baru tiap dipanggil", () => {
    expect(emptySummary()).toEqual({
      revenue: 0,
      transactionCount: 0,
      itemsSold: 0,
      averageTicket: 0,
    });
    expect(emptySummary()).not.toBe(emptySummary());
  });
});

describe("buildSalesReport - deret harian", () => {
  it("satu hari tanpa transaksi: satu titik nol, ringkasan nol", () => {
    const r = buildSalesReport([], [], range(2026, 11, 5, 2026, 11, 5));
    expect(r.daily).toEqual([
      { date: "2026-11-05", label: "5 Nov", revenue: 0, transactionCount: 0 },
    ]);
    expect(r.summary).toEqual(emptySummary());
  });

  it("satu titik untuk SETIAP hari dalam rentang (inklusif), melewati batas bulan", () => {
    const r = buildSalesReport([], [], range(2026, 10, 30, 2026, 11, 2));
    expect(r.daily.map((p) => p.date)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(r.daily.map((p) => p.label)).toEqual(["30 Okt", "31 Okt", "1 Nov", "2 Nov"]);
  });

  it("melewati pergantian DST (Los Angeles 8 Mar 2026): tidak ada hari hilang/ganda", () => {
    const r = buildSalesReport([], [], range(2026, 3, 7, 2026, 3, 10));
    expect(r.daily.map((p) => p.date)).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
  });

  it("melewati pergantian DST musim gugur (Los Angeles 1 Nov 2026)", () => {
    const r = buildSalesReport([], [], range(2026, 10, 31, 2026, 11, 2));
    expect(r.daily.map((p) => p.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("awal rentang di tengah hari dinormalkan ke awal hari", () => {
    const r = buildSalesReport([], [], {
      start: new Date(2026, 10, 5, 15, 30),
      end: new Date(2026, 10, 6, 23, 59, 59, 999),
    });
    expect(r.daily.map((p) => p.date)).toEqual(["2026-11-05", "2026-11-06"]);
  });

  it("akhir rentang tepat 23:59:59.999 masih menyertakan hari itu", () => {
    const r = buildSalesReport(
      [trx({ total: 3_000, created_at: iso(2026, 11, 6, 23, 59, 59, 999) })],
      [],
      range(2026, 11, 5, 2026, 11, 6),
    );
    expect(r.daily[1]).toMatchObject({ date: "2026-11-06", revenue: 3_000, transactionCount: 1 });
  });

  it("akhir rentang tepat tengah malam (00:00:00.000) menyertakan hari itu", () => {
    const r = buildSalesReport([], [], {
      start: new Date(2026, 10, 5, 0, 0, 0, 0),
      end: new Date(2026, 10, 7, 0, 0, 0, 0),
    });
    expect(r.daily.map((p) => p.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
  });

  it("transaksi jatuh ke titik tanggal lokalnya (00:30 tidak mundur ke kemarin)", () => {
    const r = buildSalesReport(
      [
        trx({ total: 1_000, created_at: iso(2026, 11, 5, 0, 30) }),
        trx({ total: 2_000, created_at: iso(2026, 11, 5, 23, 30) }),
        trx({ total: 4_000, created_at: iso(2026, 11, 6, 0, 0, 0, 0) }),
      ],
      [],
      range(2026, 11, 5, 2026, 11, 6),
    );
    expect(r.daily[0]).toMatchObject({ revenue: 3_000, transactionCount: 2 });
    expect(r.daily[1]).toMatchObject({ revenue: 4_000, transactionCount: 1 });
  });

  it("hari tanpa transaksi tetap nol di antara hari yang ada transaksinya", () => {
    const r = buildSalesReport(
      [
        trx({ total: 1_000, created_at: iso(2026, 11, 3) }),
        trx({ total: 5_000, created_at: iso(2026, 11, 5) }),
      ],
      [],
      range(2026, 11, 3, 2026, 11, 5),
    );
    expect(r.daily.map((p) => p.revenue)).toEqual([1_000, 0, 5_000]);
  });
});

describe("buildSalesReport - ringkasan", () => {
  it("omzet = jumlah total; jumlah transaksi hanya baris penjualan", () => {
    const r = buildSalesReport(
      [
        trx({ total: 100_000 }),
        trx({ total: 50_000 }),
        trx({ total: -20_000, related_transaction_id: "x" }),
      ],
      [],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.revenue).toBe(130_000);
    expect(r.summary.transactionCount).toBe(2);
    expect(r.daily[0]).toMatchObject({ revenue: 130_000, transactionCount: 2 });
  });

  it("retur sebagian: transaksi asli (status RETURN) + baris retur negatif = omzet bersih", () => {
    const r = buildSalesReport(
      [
        trx({ id: "A", total: 100_000, status: "RETURN" }),
        trx({ id: "R", total: -30_000, status: "RETURN", related_transaction_id: "A" }),
      ],
      [],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.revenue).toBe(70_000);
    expect(r.summary.transactionCount).toBe(1);
  });

  it("retur hari ini atas penjualan kemarin: kemarin tetap penuh, hari ini negatif", () => {
    const r = buildSalesReport(
      [
        trx({ id: "A", total: 100_000, created_at: iso(2026, 11, 4) }),
        trx({
          id: "R",
          total: -100_000,
          related_transaction_id: "A",
          created_at: iso(2026, 11, 5),
        }),
      ],
      [],
      range(2026, 11, 4, 2026, 11, 5),
    );
    expect(r.daily[0].revenue).toBe(100_000);
    expect(r.daily[1].revenue).toBe(-100_000);
    expect(r.summary.revenue).toBe(0);
  });

  it("total null dihitung 0, tetap dihitung sebagai satu transaksi", () => {
    const r = buildSalesReport([trx({ total: null })], [], range(2026, 11, 5, 2026, 11, 5));
    expect(r.summary).toMatchObject({ revenue: 0, transactionCount: 1 });
  });

  it("rata-rata per transaksi dibulatkan (10000,5 -> 10001)", () => {
    const r = buildSalesReport(
      [trx({ total: 10_000 }), trx({ total: 10_001 })],
      [],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.averageTicket).toBe(10_001);
  });

  it("tanpa transaksi penjualan: rata-rata 0 (tidak NaN / bagi nol)", () => {
    const r = buildSalesReport(
      [trx({ total: -5_000, related_transaction_id: "x" })],
      [],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.transactionCount).toBe(0);
    expect(r.summary.averageTicket).toBe(0);
  });

  it("transaksi di luar hari-hari rentang tetap masuk ringkasan tetapi tidak membuat titik harian", () => {
    // Pembatasan rentang dilakukan oleh query di hook, bukan di fungsi ini.
    const r = buildSalesReport(
      [trx({ total: 9_000, created_at: iso(2026, 11, 20) })],
      [],
      range(2026, 11, 5, 2026, 11, 6),
    );
    expect(r.daily).toHaveLength(2);
    expect(r.daily.every((p) => p.revenue === 0)).toBe(true);
    expect(r.summary.revenue).toBe(9_000);
  });
});

describe("buildSalesReport - item terjual", () => {
  it("netto = qty - returned_qty, dijumlah lintas transaksi", () => {
    const r = buildSalesReport(
      [],
      [
        item({ transaction_id: "A", qty: 5, returned_qty: 2 }),
        item({ transaction_id: "A", qty: 1 }),
        item({ transaction_id: "B", qty: 4 }),
      ],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.itemsSold).toBe(8);
  });

  it("netto 0 atau negatif diabaikan", () => {
    const r = buildSalesReport(
      [],
      [
        item({ qty: 3, returned_qty: 3 }),
        item({ qty: 2, returned_qty: 9 }),
        item({ qty: 1 }),
      ],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.itemsSold).toBe(1);
  });

  it("qty/returned_qty null dianggap 0", () => {
    const r = buildSalesReport(
      [],
      [item({ qty: null, returned_qty: null }), item({ qty: 2, returned_qty: null })],
      range(2026, 11, 5, 2026, 11, 5),
    );
    expect(r.summary.itemsSold).toBe(2);
  });

  it("tanpa item: 0", () => {
    expect(
      buildSalesReport([trx()], [], range(2026, 11, 5, 2026, 11, 5)).summary.itemsSold,
    ).toBe(0);
  });
});

// ── Per Shift ────────────────────────────────────────────────────────────────

const rawShift = (over: Partial<RawShift> = {}): RawShift => ({
  id: "s1",
  cashier_id: "u1",
  opened_at: iso(2026, 11, 5, 8),
  closed_at: iso(2026, 11, 5, 17),
  status: "CLOSED",
  opening_cash: 100_000,
  expected_cash: 350_000,
  actual_cash: 340_000,
  difference: -10_000,
  ...over,
});

describe("buildShiftRows", () => {
  it("memetakan baris shift lengkap dengan nama kasir dan kas masuk/keluar", () => {
    const rows = buildShiftRows(
      [rawShift()],
      new Map([["u1", "Rina"]]),
      { s1: { cashIn: 20_000, cashOut: 5_000 } },
    );
    expect(rows).toEqual([
      {
        id: "s1",
        cashier_id: "u1",
        cashier_name: "Rina",
        opened_at: iso(2026, 11, 5, 8),
        closed_at: iso(2026, 11, 5, 17),
        status: "CLOSED",
        opening_cash: 100_000,
        expected_cash: 350_000,
        actual_cash: 340_000,
        difference: -10_000,
        cash_in: 20_000,
        cash_out: 5_000,
      },
    ]);
  });

  it("urutan input dipertahankan", () => {
    const rows = buildShiftRows(
      [rawShift({ id: "b" }), rawShift({ id: "a" }), rawShift({ id: "c" })],
      new Map(),
      {},
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("shift OPEN: kolom penutupan tetap null (bukan 0)", () => {
    const [row] = buildShiftRows(
      [
        rawShift({
          status: "OPEN",
          closed_at: null,
          expected_cash: null,
          actual_cash: null,
          difference: null,
        }),
      ],
      new Map(),
      { s1: { cashIn: 0, cashOut: 0 } },
    );
    expect(row.closed_at).toBeNull();
    expect(row.expected_cash).toBeNull();
    expect(row.actual_cash).toBeNull();
    expect(row.difference).toBeNull();
  });

  it("nilai 0 yang sungguhan (selisih 0, kas aktual 0) dipertahankan sebagai 0, bukan null", () => {
    const [row] = buildShiftRows(
      [rawShift({ actual_cash: 0, difference: 0, expected_cash: 0 })],
      new Map(),
      {},
    );
    expect(row.actual_cash).toBe(0);
    expect(row.difference).toBe(0);
    expect(row.expected_cash).toBe(0);
  });

  it("angka dari Postgres numeric (string) diubah jadi number", () => {
    const [row] = buildShiftRows(
      [
        rawShift({
          opening_cash: "100000" as unknown as number,
          expected_cash: "350000.50" as unknown as number,
          actual_cash: "340000" as unknown as number,
          difference: "-10000.50" as unknown as number,
        }),
      ],
      new Map(),
      {},
    );
    expect(row.opening_cash).toBe(100_000);
    expect(row.expected_cash).toBe(350_000.5);
    expect(row.actual_cash).toBe(340_000);
    expect(row.difference).toBe(-10_000.5);
  });

  it("kasir tanpa nama / tidak ada di daftar -> cashier_name null", () => {
    const rows = buildShiftRows(
      [rawShift({ id: "a", cashier_id: "u1" }), rawShift({ id: "b", cashier_id: "u2" })],
      new Map<string, string | null>([["u1", null]]),
      {},
    );
    expect(rows[0].cashier_name).toBeNull();
    expect(rows[1].cashier_name).toBeNull();
  });

  it("kas masuk/keluar gagal dimuat (null): cash_in & cash_out null, BUKAN 0", () => {
    const [row] = buildShiftRows([rawShift()], new Map(), null);
    expect(row.cash_in).toBeNull();
    expect(row.cash_out).toBeNull();
  });

  it("shift tanpa entri di total kas -> 0 (data dimuat, memang tidak ada catatan)", () => {
    const [row] = buildShiftRows([rawShift({ id: "s9" })], new Map(), {
      lain: { cashIn: 5, cashOut: 5 },
    });
    expect(row.cash_in).toBe(0);
    expect(row.cash_out).toBe(0);
  });

  it("tanpa shift -> array kosong", () => {
    expect(buildShiftRows([], new Map(), null)).toEqual([]);
  });
});

// ── Piutang ──────────────────────────────────────────────────────────────────

const NOW = new Date(2026, 10, 5, 10, 30);

describe("receivableStatus", () => {
  it("sudah lunas -> LUNAS, walau jatuh tempo sudah lewat", () => {
    expect(receivableStatus("2026-10-01", true, NOW)).toBe("LUNAS");
  });

  it("belum lunas dan jatuh tempo kemarin -> JATUH_TEMPO", () => {
    expect(receivableStatus("2026-11-04", false, NOW)).toBe("JATUH_TEMPO");
  });

  it("jatuh tempo HARI INI belum dianggap lewat -> BELUM_LUNAS", () => {
    expect(receivableStatus("2026-11-05", false, NOW)).toBe("BELUM_LUNAS");
  });

  it("jatuh tempo besok / bulan depan -> BELUM_LUNAS", () => {
    expect(receivableStatus("2026-11-06", false, NOW)).toBe("BELUM_LUNAS");
    expect(receivableStatus("2026-12-01", false, NOW)).toBe("BELUM_LUNAS");
  });

  it("tanpa tanggal jatuh tempo -> BELUM_LUNAS (tidak pernah lewat tempo)", () => {
    expect(receivableStatus(null, false, NOW)).toBe("BELUM_LUNAS");
  });

  it("tanpa tanggal jatuh tempo tetapi lunas -> LUNAS", () => {
    expect(receivableStatus(null, true, NOW)).toBe("LUNAS");
  });

  it("membandingkan tanggal lokal: 00:30 hari itu masih 'hari ini', bukan kemarin", () => {
    const awalHari = new Date(2026, 10, 5, 0, 30);
    expect(receivableStatus("2026-11-05", false, awalHari)).toBe("BELUM_LUNAS");
    expect(receivableStatus("2026-11-04", false, awalHari)).toBe("JATUH_TEMPO");
  });

  it("tanpa argumen now memakai jam sekarang (perilaku lama)", () => {
    expect(receivableStatus("2000-01-01", false)).toBe("JATUH_TEMPO");
    expect(receivableStatus("2999-01-01", false)).toBe("BELUM_LUNAS");
  });
});

const rawPay = (over: Partial<RawPayment> = {}): RawPayment => ({
  id: "pay1",
  transaction_id: "t1",
  amount: 75_000,
  due_date: "2026-11-10",
  is_settled: false,
  settled_at: null,
  created_at: iso(2026, 11, 1),
  ...over,
});

describe("buildReceivableRows", () => {
  it("menggabungkan pembayaran dengan identitas transaksinya", () => {
    const rows = buildReceivableRows(
      [rawPay()],
      new Map([["t1", { id: "t1", receipt_no: "INV-001", customer_name: "Budi" }]]),
      NOW,
    );
    expect(rows).toEqual([
      {
        payment_id: "pay1",
        transaction_id: "t1",
        receipt_no: "INV-001",
        customer_name: "Budi",
        amount: 75_000,
        due_date: "2026-11-10",
        is_settled: false,
        settled_at: null,
        status: "BELUM_LUNAS",
        created_at: iso(2026, 11, 1),
      },
    ]);
  });

  it("transaksi tidak ditemukan -> receipt_no '-' dan customer_name null", () => {
    const [row] = buildReceivableRows([rawPay()], new Map(), NOW);
    expect(row.receipt_no).toBe("-");
    expect(row.customer_name).toBeNull();
  });

  it("status dihitung per baris: lunas, jatuh tempo, belum lunas", () => {
    const rows = buildReceivableRows(
      [
        rawPay({ id: "a", is_settled: true, settled_at: iso(2026, 11, 3), due_date: "2026-10-01" }),
        rawPay({ id: "b", due_date: "2026-11-01" }),
        rawPay({ id: "c", due_date: "2026-11-30" }),
      ],
      new Map(),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(["LUNAS", "JATUH_TEMPO", "BELUM_LUNAS"]);
    expect(rows[0].settled_at).toBe(iso(2026, 11, 3));
  });

  it("amount dari Postgres numeric (string) jadi number; null jadi 0", () => {
    const rows = buildReceivableRows(
      [
        rawPay({ id: "a", amount: "120000.5" as unknown as number }),
        rawPay({ id: "b", amount: null as unknown as number }),
      ],
      new Map(),
      NOW,
    );
    expect(rows[0].amount).toBe(120_000.5);
    expect(rows[1].amount).toBe(0);
  });

  it("urutan input dipertahankan (query sudah mengurutkan jatuh tempo)", () => {
    const rows = buildReceivableRows(
      [rawPay({ id: "z" }), rawPay({ id: "a" }), rawPay({ id: "m" })],
      new Map(),
      NOW,
    );
    expect(rows.map((r) => r.payment_id)).toEqual(["z", "a", "m"]);
  });

  it("tanpa pembayaran -> array kosong", () => {
    expect(buildReceivableRows([], new Map(), NOW)).toEqual([]);
  });

  it("beberapa pembayaran milik satu transaksi memakai identitas yang sama", () => {
    const rows = buildReceivableRows(
      [rawPay({ id: "a" }), rawPay({ id: "b" })],
      new Map([["t1", { id: "t1", receipt_no: "INV-9", customer_name: null }]]),
      NOW,
    );
    expect(rows.map((r) => r.receipt_no)).toEqual(["INV-9", "INV-9"]);
    expect(rows.every((r) => r.customer_name === null)).toBe(true);
  });
});
