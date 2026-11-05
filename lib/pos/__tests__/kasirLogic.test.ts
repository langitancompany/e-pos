import { describe, expect, it } from "vitest";
import {
  buildSaleReceipt,
  buildShiftOpenReceipt,
  buildShiftCloseReceipt,
  calcDiscount,
  calcGrandTotal,
  calcPointsBeingUsed,
  calcTax,
  filterCustomers,
  filterProducts,
  filterServiceProducts,
  parseDigits,
  resolveBarcodeScan,
  resolvePcCode,
  summarizeSplitPayment,
} from "../kasirLogic";
import type { CartItem, Product } from "../types";

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    sku: "SKU-1",
    barcode: null,
    name: "Kaos Polos",
    type: "FASHION",
    is_service: false,
    category_id: null,
    unit: null,
    sell_price: 50_000,
    cost_price: null,
    stock: 10,
    min_stock: 0,
    photo_url: null,
    is_active: true,
    created_at: "",
    updated_at: "",
    deleted_at: null,
    ...over,
  };
}

describe("parseDigits", () => {
  it("membuang karakter non-digit", () => {
    expect(parseDigits("Rp 12.500")).toBe(12_500);
  });
  it("kosong / tanpa angka -> 0", () => {
    expect(parseDigits("")).toBe(0);
    expect(parseDigits("abc")).toBe(0);
  });
});

describe("calcTax", () => {
  it("0 saat PPN mati", () => {
    expect(calcTax(100_000, false, 11)).toBe(0);
  });
  it("membulatkan ke rupiah terdekat", () => {
    expect(calcTax(100_000, true, 11)).toBe(11_000);
    expect(calcTax(10_050, true, 11)).toBe(1_106); // 1105.5 -> 1106
    expect(calcTax(10_049, true, 11)).toBe(1_105); // 1105.39 -> 1105
  });
});

describe("calcPointsBeingUsed", () => {
  const base = {
    loyaltyEnabled: true,
    usePoints: true,
    customerPoints: 500,
    subtotal: 100_000,
    tax: 0,
    pointValue: 100,
  };
  it("memakai seluruh saldo kalau masih terjangkau", () => {
    expect(calcPointsBeingUsed(base)).toBe(500);
  });
  it("dibatasi subtotal+pajak supaya total tidak negatif", () => {
    expect(calcPointsBeingUsed({ ...base, customerPoints: 5_000 })).toBe(1_000);
    expect(
      calcPointsBeingUsed({ ...base, customerPoints: 5_000, tax: 11_000 }),
    ).toBe(1_110);
  });
  it("0 saat loyalitas mati, poin tidak dipakai, atau tanpa pelanggan", () => {
    expect(calcPointsBeingUsed({ ...base, loyaltyEnabled: false })).toBe(0);
    expect(calcPointsBeingUsed({ ...base, usePoints: false })).toBe(0);
    expect(calcPointsBeingUsed({ ...base, customerPoints: null })).toBe(0);
  });
});

describe("calcDiscount & calcGrandTotal", () => {
  it("menjumlah potongan poin dan diskon manual", () => {
    const d = calcDiscount({
      pointsBeingUsed: 100,
      pointValue: 100,
      manualDiscount: 5_000,
      subtotal: 100_000,
      tax: 0,
    });
    expect(d).toBe(15_000);
    expect(calcGrandTotal(100_000, d, 0)).toBe(85_000);
  });
  it("diskon manual dibatasi sisa kuota setelah poin", () => {
    const d = calcDiscount({
      pointsBeingUsed: 900,
      pointValue: 100,
      manualDiscount: 50_000,
      subtotal: 100_000,
      tax: 0,
    });
    expect(d).toBe(100_000); // 90.000 poin + sisa 10.000
    expect(calcGrandTotal(100_000, d, 0)).toBe(0);
  });
  it("grand total tidak pernah negatif akibat diskon manual berlebih", () => {
    const d = calcDiscount({
      pointsBeingUsed: 0,
      pointValue: 100,
      manualDiscount: 999_999,
      subtotal: 40_000,
      tax: 4_400,
    });
    expect(calcGrandTotal(40_000, d, 4_400)).toBe(0);
  });
});

describe("filterProducts", () => {
  const items = [
    makeProduct({ id: "a", name: "Kaos Hitam", sku: "K-01", category_id: "c1" }),
    makeProduct({ id: "b", name: "Topi", sku: "T-01", barcode: "899123", category_id: "c2" }),
  ];
  it("tanpa filter mengembalikan semua", () => {
    expect(filterProducts(items, "", null)).toHaveLength(2);
  });
  it("cocok di nama, SKU, atau barcode (case-insensitive)", () => {
    expect(filterProducts(items, "HITAM", null).map((p) => p.id)).toEqual(["a"]);
    expect(filterProducts(items, "t-01", null).map((p) => p.id)).toEqual(["b"]);
    expect(filterProducts(items, "8991", null).map((p) => p.id)).toEqual(["b"]);
  });
  it("menggabungkan filter kategori dan teks", () => {
    expect(filterProducts(items, "k", "c2")).toEqual([]);
    expect(filterProducts(items, "", "c2").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("filterServiceProducts", () => {
  it("menyertakan Jasa, extra charge, dan KEMASAN", () => {
    const list = [
      makeProduct({ id: "jasa", is_service: true }),
      makeProduct({ id: "extra", is_extra_charge: true }),
      makeProduct({ id: "kemasan", type: "KEMASAN" }),
      makeProduct({ id: "biasa" }),
    ];
    expect(filterServiceProducts(list).map((p) => p.id)).toEqual([
      "jasa",
      "extra",
      "kemasan",
    ]);
  });
});

describe("filterCustomers", () => {
  const customers = [
    { name: "Ahmad Muhammad Rizki", phone: "0812" },
    { name: "Budi", phone: "0899" },
    { name: "Citra", phone: null },
  ];
  it("query kosong -> []", () => {
    expect(filterCustomers(customers, "   ")).toEqual([]);
  });
  it("mencocokkan per-kata di nama, urutan bebas", () => {
    expect(filterCustomers(customers, "muhammad ahmad")).toHaveLength(1);
  });
  it("mencari di no. HP dan menangani phone null", () => {
    expect(filterCustomers(customers, "0899")[0].name).toBe("Budi");
    expect(filterCustomers(customers, "citra")).toHaveLength(1);
  });
  it("dibatasi `limit`", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `Pelanggan ${i}`,
      phone: null,
    }));
    expect(filterCustomers(many, "pelanggan")).toHaveLength(12);
    expect(filterCustomers(many, "pelanggan", 5)).toHaveLength(5);
  });
});

describe("resolvePcCode", () => {
  const products = [
    makeProduct({ id: "a", sku: "P1", barcode: "111" }),
    makeProduct({ id: "b", sku: "P2", barcode: null }),
  ];
  it("input kosong -> empty", () => {
    expect(resolvePcCode(products, "  ")).toEqual({ kind: "empty" });
  });
  it("kode polos cocok SKU atau barcode persis, case-insensitive", () => {
    expect(resolvePcCode(products, "p1")).toMatchObject({ kind: "found", qty: 1 });
    const r = resolvePcCode(products, "111");
    expect(r.kind === "found" && r.product.id).toBe("a");
  });
  it("format qty*kode", () => {
    const r = resolvePcCode(products, "3*p2");
    expect(r).toMatchObject({ kind: "found", qty: 3 });
    expect(r.kind === "found" && r.product.id).toBe("b");
  });
  it("qty pecahan dibulatkan ke bawah", () => {
    const r = resolvePcCode(products, "2.9*p1");
    expect(r).toMatchObject({ kind: "found", qty: 2 });
  });
  it("qty tidak valid -> seluruh teks dianggap kode", () => {
    const r = resolvePcCode(products, "0*p1");
    expect(r).toEqual({
      kind: "error",
      message: 'Produk dengan kode "0*p1" tidak ditemukan.',
    });
  });
  it("kode kosong setelah *", () => {
    expect(resolvePcCode(products, "3*")).toEqual({
      kind: "error",
      message: "Kode tidak boleh kosong.",
    });
  });
  it("tidak cocok parsial (bukan includes)", () => {
    expect(resolvePcCode(products, "p").kind).toBe("error");
  });
});

describe("resolveBarcodeScan", () => {
  const prod = makeProduct({ id: "a", sku: "SKU-A", barcode: "899", stock: 2 });
  const cartWith = (qty: number): CartItem[] => [{ product: prod, qty }];

  it("tidak ditemukan", () => {
    const r = resolveBarcodeScan([prod], [], " 000 ");
    expect(r.productToAdd).toBeUndefined();
    expect(r.feedback).toEqual({
      type: "error",
      message: 'Barcode "000" tidak ditemukan di daftar produk.',
    });
  });
  it("cocok barcode dulu, lalu SKU (case-insensitive)", () => {
    expect(resolveBarcodeScan([prod], [], "899").productToAdd).toBe(prod);
    expect(resolveBarcodeScan([prod], [], "sku-a").productToAdd).toBe(prod);
  });
  it("stok habis", () => {
    const empty = makeProduct({ barcode: "1", stock: 0 });
    const r = resolveBarcodeScan([empty], [], "1");
    expect(r.feedback).toEqual({ type: "error", message: "Kaos Polos — stok habis." });
  });
  it("produk Jasa tidak pernah habis stok", () => {
    const jasa = makeProduct({ barcode: "J", stock: 0, is_service: true });
    expect(resolveBarcodeScan([jasa], [], "J").feedback.type).toBe("success");
  });
  it("sudah mencapai stok maksimal di keranjang", () => {
    const r = resolveBarcodeScan([prod], cartWith(2), "899");
    expect(r.productToAdd).toBeUndefined();
    expect(r.feedback.message).toContain("sudah mencapai stok maksimal");
  });
  it("sukses selagi masih di bawah stok", () => {
    const r = resolveBarcodeScan([prod], cartWith(1), "899");
    expect(r.feedback).toEqual({
      type: "success",
      message: "Kaos Polos ditambahkan ke keranjang.",
    });
  });
});

describe("summarizeSplitPayment", () => {
  it("menjumlah semua baris dan menggabung label metode", () => {
    expect(
      summarizeSplitPayment([
        { method: "CASH", amount: 30_000 },
        { method: "DIGITAL", amount: 20_000 },
      ]),
    ).toEqual({ totalPaid: 50_000, methodLabel: "Tunai + Digital" });
  });
});

describe("buildSaleReceipt", () => {
  it("memetakan keranjang ke item struk dan mempertahankan branding", () => {
    const r = buildSaleReceipt({
      branding: { storeName: "Toko X", footerText: "Terima kasih" },
      receiptNo: "R-1",
      createdAt: "2026-11-05T00:00:00.000Z",
      cashierName: "Rina",
      customerName: undefined,
      cart: [{ product: makeProduct({ name: "Kaos", sell_price: 25_000 }), qty: 2 }],
      subtotal: 50_000,
      discount: 0,
      tax: 0,
      total: 50_000,
      paidAmount: 100_000,
      changeAmount: 50_000,
      method: "CASH",
    });
    expect(r.storeName).toBe("Toko X");
    expect(r.items).toEqual([{ name: "Kaos", price: 25_000, qty: 2 }]);
    expect(r.paidAmount).toBe(100_000);
    expect(r.changeAmount).toBe(50_000);
  });
});

describe("buildShiftOpenReceipt", () => {
  it("memakai layout shift_open tanpa item", () => {
    const now = new Date("2026-11-05T01:02:03.000Z");
    const r = buildShiftOpenReceipt({
      branding: { storeName: "Toko X" },
      now,
      cashierName: null,
      openingCash: 200_000,
    });
    expect(r.kind).toBe("shift_open");
    expect(r.receiptNo).toBe(`BUKA-${now.getTime()}`);
    expect(r.items).toEqual([]);
    expect(r.openingCash).toBe(200_000);
    expect(r.total).toBe(200_000);
    expect(r.method).toBe("Buka Kasir");
  });
});

describe("buildShiftCloseReceipt", () => {
  it("memakai layout shift_close dengan rincian kas & selisih", () => {
    const now = new Date("2026-11-05T15:06:48.000Z");
    const r = buildShiftCloseReceipt({
      branding: { storeName: "Toko X" },
      now,
      cashierName: "Budi",
      openedAt: "2026-11-05T15:05:00.000Z",
      result: {
        shift_id: "s1",
        opening_cash: 200_000,
        cash_sales: 75_000,
        cash_refunds: 0,
        cash_in: 0,
        cash_out: 10_000,
        expected_cash: 265_000,
        actual_cash: 260_000,
        difference: -5_000,
        notes: "salah kembalian",
      },
    });
    expect(r.kind).toBe("shift_close");
    expect(r.receiptNo).toBe(`TUTUP-${now.getTime()}`);
    expect(r.items).toEqual([]);
    expect(r.openingCash).toBe(200_000);
    expect(r.shiftClose?.expectedCash).toBe(265_000);
    expect(r.shiftClose?.difference).toBe(-5_000);
    expect(r.shiftClose?.notes).toBe("salah kembalian");
  });
});
