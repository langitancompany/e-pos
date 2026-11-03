import { describe, expect, it } from "vitest";
import { estimateReturn, summarizeReturns } from "../returnPreview";

const item = (id: string, qty: number, subtotal: number) => ({ id, qty, subtotal });

describe("estimateReturn", () => {
  it("retur sebagian tanpa diskon, dibayar tunai penuh", () => {
    const r = estimateReturn({
      items: [item("a", 2, 20_000)],
      qtyById: { a: 1 },
      saleSubtotal: 20_000,
      saleTotal: 20_000,
      payments: [{ method: "CASH", amount: 20_000 }],
      previouslyRefunded: 0,
    });
    expect(r).toEqual({ refundTotal: 10_000, cash: 10_000, digital: 0, unrecorded: 0 });
  });

  it("memperhitungkan diskon transaksi secara proporsional", () => {
    const r = estimateReturn({
      items: [item("a", 2, 20_000)],
      qtyById: { a: 1 },
      saleSubtotal: 20_000,
      saleTotal: 18_000, // diskon 10%
      payments: [{ method: "CASH", amount: 18_000 }],
      previouslyRefunded: 0,
    });
    expect(r.refundTotal).toBe(9_000);
  });

  it("membagi refund ke tunai/digital menurut komposisi pembayaran asli", () => {
    const r = estimateReturn({
      items: [item("a", 1, 20_000)],
      qtyById: { a: 1 },
      saleSubtotal: 20_000,
      saleTotal: 20_000,
      payments: [
        { method: "CASH", amount: 10_000 },
        { method: "DIGITAL", amount: 10_000 },
      ],
      previouslyRefunded: 0,
    });
    expect(r).toEqual({ refundTotal: 20_000, cash: 10_000, digital: 10_000, unrecorded: 0 });
  });

  it("bagian piutang (TEMPO) masuk 'unrecorded'", () => {
    const r = estimateReturn({
      items: [item("a", 1, 20_000)],
      qtyById: { a: 1 },
      saleSubtotal: 20_000,
      saleTotal: 20_000,
      payments: [
        { method: "CASH", amount: 10_000 },
        { method: "TEMPO", amount: 10_000 },
      ],
      previouslyRefunded: 0,
    });
    expect(r).toEqual({ refundTotal: 20_000, cash: 10_000, digital: 0, unrecorded: 10_000 });
  });

  it("total semua retur tidak boleh melebihi total transaksi", () => {
    const r = estimateReturn({
      items: [item("a", 2, 20_000)],
      qtyById: { a: 2 },
      saleSubtotal: 20_000,
      saleTotal: 20_000,
      payments: [{ method: "CASH", amount: 20_000 }],
      previouslyRefunded: 15_000,
    });
    expect(r.refundTotal).toBe(5_000);
  });

  it("mengabaikan qty 0, kosong, atau item ber-qty 0", () => {
    const r = estimateReturn({
      items: [item("a", 2, 20_000), item("b", 0, 5_000)],
      qtyById: { a: 0, b: 3 },
      saleSubtotal: 25_000,
      saleTotal: 25_000,
      payments: [{ method: "CASH", amount: 25_000 }],
      previouslyRefunded: 0,
    });
    expect(r.refundTotal).toBe(0);
  });

  it("tanpa data pembayaran, seluruh refund 'unrecorded'", () => {
    const r = estimateReturn({
      items: [item("a", 1, 10_000)],
      qtyById: { a: 1 },
      saleSubtotal: 10_000,
      saleTotal: 10_000,
      payments: [],
      previouslyRefunded: 0,
    });
    expect(r).toEqual({ refundTotal: 10_000, cash: 0, digital: 0, unrecorded: 10_000 });
  });

  it("saleSubtotal 0 tidak menyebabkan pembagian dengan nol", () => {
    const r = estimateReturn({
      items: [item("a", 1, 10_000)],
      qtyById: { a: 1 },
      saleSubtotal: 0,
      saleTotal: 10_000,
      payments: [{ method: "CASH", amount: 10_000 }],
      previouslyRefunded: 0,
    });
    expect(Number.isFinite(r.refundTotal)).toBe(true);
    expect(r.refundTotal).toBe(10_000);
  });
});

describe("summarizeReturns", () => {
  it("menjumlah refund, tunai, digital, dan sisa tak tercatat", () => {
    const s = summarizeReturns([
      {
        refundAmount: 10_000,
        payments: [
          { method: "CASH", amount: -6_000 },
          { method: "DIGITAL", amount: -4_000 },
        ],
      },
      { refundAmount: 5_000, payments: [] },
    ]);
    expect(s).toEqual({ refundTotal: 15_000, cash: 6_000, digital: 4_000, unrecorded: 5_000 });
  });

  it("daftar kosong menghasilkan nol semua", () => {
    expect(summarizeReturns([])).toEqual({ refundTotal: 0, cash: 0, digital: 0, unrecorded: 0 });
  });

  it("unrecorded tidak pernah negatif", () => {
    const s = summarizeReturns([
      { refundAmount: 1_000, payments: [{ method: "CASH", amount: -2_000 }] },
    ]);
    expect(s.unrecorded).toBe(0);
  });
});
