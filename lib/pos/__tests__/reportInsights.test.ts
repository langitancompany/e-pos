import { describe, expect, it } from "vitest";
import {
  addDays,
  buildCashOut,
  buildPaymentMix,
  buildTopProducts,
  deltaPercent,
  endOfDay,
  methodLabel,
  normalizeMethod,
  previousRange,
  startOfDay,
  summarizeSales,
} from "../reportInsights";

// Semua tanggal dibuat dengan konstruktor lokal (tahun, bulan 0-based, hari)
// supaya hasilnya sama di zona waktu mana pun.

describe("startOfDay / endOfDay / addDays", () => {
  it("startOfDay -> 00:00:00.000 hari yang sama, tanpa mengubah input", () => {
    const input = new Date(2026, 9, 5, 14, 30, 15, 500);
    const result = startOfDay(input);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(9);
    expect(result.getDate()).toBe(5);
    expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([0, 0, 0]);
    expect(result.getMilliseconds()).toBe(0);
    expect(input.getHours()).toBe(14);
  });

  it("endOfDay -> 23:59:59.999", () => {
    const result = endOfDay(new Date(2026, 9, 5, 1, 2, 3));
    expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([23, 59, 59]);
    expect(result.getMilliseconds()).toBe(999);
  });

  it("addDays menggeser tanggal kalender, lintas bulan, dan menerima negatif", () => {
    expect(addDays(new Date(2026, 9, 30), 3).getDate()).toBe(2);
    expect(addDays(new Date(2026, 9, 30), 3).getMonth()).toBe(10);
    expect(addDays(new Date(2026, 9, 1), -1).getDate()).toBe(30);
    expect(addDays(new Date(2026, 9, 1), -1).getMonth()).toBe(8);
  });
});

describe("previousRange", () => {
  it("rentang 1-15 Okt -> pembanding 16-30 Sep (sama panjang, tepat sebelumnya)", () => {
    const prev = previousRange({
      start: new Date(2026, 9, 1),
      end: new Date(2026, 9, 15, 23, 59, 59, 999),
    });
    expect([prev.start.getMonth(), prev.start.getDate()]).toEqual([8, 16]);
    expect([prev.end.getMonth(), prev.end.getDate()]).toEqual([8, 30]);
    expect(prev.start.getHours()).toBe(0);
    expect(prev.end.getHours()).toBe(23);
    expect(prev.end.getMilliseconds()).toBe(999);
  });

  it("rentang satu hari -> pembanding hari sebelumnya", () => {
    const prev = previousRange({
      start: new Date(2026, 9, 10),
      end: new Date(2026, 9, 10, 23, 59, 59, 999),
    });
    expect(prev.start.getDate()).toBe(9);
    expect(prev.end.getDate()).toBe(9);
  });

  it("jam pada start/end diabaikan, yang dihitung hari kalender", () => {
    const prev = previousRange({
      start: new Date(2026, 9, 10, 18, 0),
      end: new Date(2026, 9, 12, 6, 0),
    });
    // 10-12 Okt = 3 hari -> pembanding 7-9 Okt
    expect(prev.start.getDate()).toBe(7);
    expect(prev.end.getDate()).toBe(9);
  });
});

describe("summarizeSales", () => {
  it("omzet = penjualan + retur (negatif); jumlah transaksi hanya penjualan", () => {
    const summary = summarizeSales(
      [
        { id: "a", total: 100_000, status: "PAID", related_transaction_id: null },
        { id: "b", total: 50_000, status: "PAID", related_transaction_id: null },
        { id: "r", total: -30_000, status: "RETURN", related_transaction_id: "a" },
      ],
      [],
    );
    expect(summary.revenue).toBe(120_000);
    expect(summary.transactionCount).toBe(2);
    expect(summary.averageTicket).toBe(60_000);
  });

  it("item terjual = qty - returned_qty; item bernilai <= 0 diabaikan", () => {
    const summary = summarizeSales(
      [],
      [
        { transaction_id: "a", qty: 3, returned_qty: 1 },
        { transaction_id: "a", qty: 2, returned_qty: 2 },
        { transaction_id: "b", qty: 1, returned_qty: 5 },
        { transaction_id: "b", qty: 4, returned_qty: 0 },
      ],
    );
    expect(summary.itemsSold).toBe(2 + 4);
  });

  it("rata-rata struk dibulatkan; tanpa transaksi = 0 (tidak NaN)", () => {
    const rounded = summarizeSales(
      [
        { id: "a", total: 10_000, status: "PAID", related_transaction_id: null },
        { id: "b", total: 10_001, status: "PAID", related_transaction_id: null },
      ],
      [],
    );
    expect(rounded.averageTicket).toBe(10_001);

    const empty = summarizeSales([], []);
    expect(empty).toEqual({
      revenue: 0,
      transactionCount: 0,
      itemsSold: 0,
      averageTicket: 0,
    });
  });
});

describe("deltaPercent", () => {
  it("naik dan turun dalam persen", () => {
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(50, 100)).toBe(-50);
    expect(deltaPercent(100, 100)).toBe(0);
  });

  it("pembanding 0 -> null (tidak bisa dihitung persennya)", () => {
    expect(deltaPercent(100, 0)).toBeNull();
    expect(deltaPercent(0, 0)).toBeNull();
  });

  it("pembanding negatif memakai nilai mutlak sebagai dasar", () => {
    expect(deltaPercent(-50, -100)).toBe(50);
  });
});

describe("normalizeMethod / methodLabel", () => {
  it("nilai lama dan baru disatukan", () => {
    expect(normalizeMethod("CASH")).toBe("tunai");
    expect(normalizeMethod("tunai")).toBe("tunai");
    expect(normalizeMethod("BANK_TRANSFER")).toBe("transfer");
    expect(normalizeMethod(" Transfer ")).toBe("transfer");
    expect(normalizeMethod("QRIS")).toBe("qris");
    expect(normalizeMethod("TEMPO")).toBe("tempo");
  });

  it("kosong/null -> lainnya; metode lain dipertahankan huruf kecil", () => {
    expect(normalizeMethod(null)).toBe("lainnya");
    expect(normalizeMethod(undefined)).toBe("lainnya");
    expect(normalizeMethod("")).toBe("lainnya");
    expect(normalizeMethod("DIGITAL")).toBe("digital");
  });

  it("label untuk kunci yang dikenal dan kapitalisasi untuk yang tidak", () => {
    expect(methodLabel("tunai")).toBe("Tunai");
    expect(methodLabel("tempo")).toBe("Tempo (piutang)");
    expect(methodLabel("digital")).toBe("Digital");
  });
});

describe("buildPaymentMix", () => {
  it("menggabungkan CASH dan tunai jadi satu baris, urut dari terbesar", () => {
    const mix = buildPaymentMix([
      { transaction_id: "a", method: "CASH", amount: 50_000 },
      { transaction_id: "b", method: "tunai", amount: 25_000 },
      { transaction_id: "c", method: "QRIS", amount: 100_000 },
    ]);
    expect(mix.map((r) => r.key)).toEqual(["qris", "tunai"]);
    expect(mix[1]).toEqual({
      key: "tunai",
      label: "Tunai",
      amount: 75_000,
      transactionCount: 2,
    });
  });

  it("transaksi split dihitung sekali per metode", () => {
    const mix = buildPaymentMix([
      { transaction_id: "a", method: "tunai", amount: 10_000 },
      { transaction_id: "a", method: "tunai", amount: 5_000 },
      { transaction_id: "a", method: "qris", amount: 20_000 },
    ]);
    const tunai = mix.find((r) => r.key === "tunai");
    expect(tunai?.amount).toBe(15_000);
    expect(tunai?.transactionCount).toBe(1);
    expect(mix.find((r) => r.key === "qris")?.transactionCount).toBe(1);
  });

  it("tanpa pembayaran -> daftar kosong", () => {
    expect(buildPaymentMix([])).toEqual([]);
  });
});

describe("buildTopProducts", () => {
  it("omzet bersih dikurangi bagian yang diretur secara proporsional", () => {
    const [row] = buildTopProducts([
      {
        transaction_id: "a",
        product_id: "p1",
        product_name: "Kaos",
        qty: 4,
        returned_qty: 1,
        subtotal: 400_000,
      },
    ]);
    expect(row.qty).toBe(3);
    expect(row.revenue).toBe(300_000);
  });

  it("item yang diretur seluruhnya tidak muncul", () => {
    expect(
      buildTopProducts([
        {
          transaction_id: "a",
          product_id: "p1",
          product_name: "Kaos",
          qty: 2,
          returned_qty: 2,
          subtotal: 200_000,
        },
      ]),
    ).toEqual([]);
  });

  it("menggabungkan produk yang sama lintas transaksi dan mengurutkan dari omzet terbesar", () => {
    const rows = buildTopProducts([
      { transaction_id: "a", product_id: "p1", product_name: "Kaos", qty: 1, returned_qty: 0, subtotal: 100_000 },
      { transaction_id: "b", product_id: "p2", product_name: "Topi", qty: 1, returned_qty: 0, subtotal: 150_000 },
      { transaction_id: "c", product_id: "p1", product_name: "Kaos", qty: 2, returned_qty: 0, subtotal: 200_000 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["p1", "p2"]);
    expect(rows[0]).toMatchObject({ qty: 3, revenue: 300_000 });
  });

  it("tanpa product_id, nama yang sama (beda huruf besar/spasi tepi) digabung", () => {
    const rows = buildTopProducts([
      { transaction_id: "a", product_name: "Kaos Polos", qty: 1, returned_qty: 0, subtotal: 50_000 },
      { transaction_id: "b", product_name: " kaos polos ", qty: 1, returned_qty: 0, subtotal: 50_000 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "nama:kaos polos", qty: 2, revenue: 100_000 });
  });

  it("nama kosong -> 'Tanpa nama'; limit membatasi jumlah baris", () => {
    const [row] = buildTopProducts([
      { transaction_id: "a", product_name: "  ", qty: 1, returned_qty: 0, subtotal: 1_000 },
    ]);
    expect(row.name).toBe("Tanpa nama");

    const many = Array.from({ length: 15 }, (_, i) => ({
      transaction_id: "t",
      product_id: `p${i}`,
      product_name: `P${i}`,
      qty: 1,
      returned_qty: 0,
      subtotal: (i + 1) * 1_000,
    }));
    expect(buildTopProducts(many)).toHaveLength(10);
    expect(buildTopProducts(many, 3)).toHaveLength(3);
    expect(buildTopProducts(many, 3)[0].key).toBe("p14");
  });

  it("omzet sama -> urut berdasarkan qty terbanyak", () => {
    const rows = buildTopProducts([
      { transaction_id: "a", product_id: "sedikit", product_name: "A", qty: 1, returned_qty: 0, subtotal: 100_000 },
      { transaction_id: "b", product_id: "banyak", product_name: "B", qty: 5, returned_qty: 0, subtotal: 100_000 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["banyak", "sedikit"]);
  });
});

describe("buildCashOut", () => {
  it("mengelompokkan per kategori, memakai label, dan mengurutkan dari terbesar", () => {
    const summary = buildCashOut(
      [
        { category: "operasional", amount: 20_000 },
        { category: "bahan", amount: 100_000 },
        { category: "operasional", amount: 30_000 },
      ],
      { operasional: "Operasional", bahan: "Bahan Baku" },
    );
    expect(summary.total).toBe(150_000);
    expect(summary.rows).toEqual([
      { category: "bahan", label: "Bahan Baku", amount: 100_000, count: 1 },
      { category: "operasional", label: "Operasional", amount: 50_000, count: 2 },
    ]);
  });

  it("kategori tanpa label memakai kodenya; tanpa data -> kosong", () => {
    const summary = buildCashOut([{ category: "lain", amount: 5_000 }], {});
    expect(summary.rows[0].label).toBe("lain");
    expect(buildCashOut([], {})).toEqual({ rows: [], total: 0 });
  });
});
