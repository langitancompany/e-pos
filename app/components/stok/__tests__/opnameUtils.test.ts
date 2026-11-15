import { describe, expect, it } from "vitest";
import {
  OPNAME_STATUS_LABEL,
  computeOpnameStats,
  itemDiff,
  opnameStatusColorClass,
} from "../opnameUtils";
import type { OpnameItem } from "@/hooks/useOpname";

const item = (over: Partial<OpnameItem> = {}): OpnameItem =>
  ({
    id: "i",
    system_qty: 10,
    counted_qty: null,
    cost_price: 1_000,
    ...over,
  }) as OpnameItem;

describe("itemDiff", () => {
  it("null bila belum dihitung", () => {
    expect(itemDiff(item())).toBeNull();
  });

  it("hitung - sistem: lebih, kurang, sama", () => {
    expect(itemDiff(item({ counted_qty: 12 }))).toBe(2);
    expect(itemDiff(item({ counted_qty: 7 }))).toBe(-3);
    expect(itemDiff(item({ counted_qty: 10 }))).toBe(0);
  });

  it("hasil hitung 0 berbeda dari belum dihitung", () => {
    expect(itemDiff(item({ counted_qty: 0 }))).toBe(-10);
  });
});

describe("computeOpnameStats", () => {
  it("daftar kosong: semua nol", () => {
    expect(computeOpnameStats([])).toEqual({
      total: 0, counted: 0, uncounted: 0, matched: 0,
      withDiff: 0, plusQty: 0, minusQty: 0, diffValue: 0,
    });
  });

  it("semua belum dihitung", () => {
    const s = computeOpnameStats([item(), item()]);
    expect(s).toMatchObject({ total: 2, counted: 0, uncounted: 2, withDiff: 0, diffValue: 0 });
  });

  it("campuran: cocok, lebih, kurang, belum dihitung", () => {
    const s = computeOpnameStats([
      item({ counted_qty: 10 }), // cocok
      item({ counted_qty: 13, cost_price: 2_000 }), // +3 -> +6.000
      item({ counted_qty: 6, cost_price: 500 }), // -4 -> -2.000
      item(), // belum
    ]);
    expect(s).toEqual({
      total: 4,
      counted: 3,
      uncounted: 1,
      matched: 1,
      withDiff: 2,
      plusQty: 3,
      minusQty: 4,
      diffValue: 6_000 - 2_000,
    });
  });

  it("kerugian bersih bernilai negatif", () => {
    const s = computeOpnameStats([item({ counted_qty: 5, cost_price: 1_000 })]);
    expect(s.diffValue).toBe(-5_000);
    expect(s.minusQty).toBe(5);
    expect(s.plusQty).toBe(0);
  });

  it("harga modal kosong dihitung 0 (selisih qty tetap tercatat)", () => {
    const s = computeOpnameStats([item({ counted_qty: 15, cost_price: null })]);
    expect(s.withDiff).toBe(1);
    expect(s.plusQty).toBe(5);
    expect(s.diffValue).toBe(0);
  });

  it("item cocok tidak mempengaruhi nilai selisih", () => {
    const s = computeOpnameStats([item({ counted_qty: 10, cost_price: 99_999 })]);
    expect(s.diffValue).toBe(0);
    expect(s.matched).toBe(1);
  });

  it("invarian: counted + uncounted = total; matched + withDiff = counted", () => {
    const s = computeOpnameStats([
      item({ counted_qty: 10 }), item({ counted_qty: 1 }), item({ counted_qty: 20 }), item(), item(),
    ]);
    expect(s.counted + s.uncounted).toBe(s.total);
    expect(s.matched + s.withDiff).toBe(s.counted);
  });
});

describe("label & warna status", () => {
  it("label Indonesia untuk tiap status", () => {
    expect(OPNAME_STATUS_LABEL).toEqual({
      draft: "Berjalan",
      completed: "Selesai",
      cancelled: "Dibatalkan",
    });
  });

  it("warna per status", () => {
    expect(opnameStatusColorClass("draft")).toContain("lco-mustard");
    expect(opnameStatusColorClass("completed")).toContain("lco-green");
    expect(opnameStatusColorClass("cancelled")).toContain("zinc");
  });
});
