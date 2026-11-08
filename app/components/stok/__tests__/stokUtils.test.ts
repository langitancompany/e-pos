import { describe, expect, it } from "vitest";
import {
  STOCK_STATUS_LABEL,
  deltaColorClass,
  formatDateOnly,
  formatDateTime,
  formatDelta,
  formatNumber,
  formatRupiah,
  getStockStatus,
  movementTypeColorClass,
  stockStatusColorClass,
  toDateInputValue,
} from "../stokUtils";
import type { StockMovementType } from "@/hooks/useStock";

describe("formatNumber & formatRupiah", () => {
  it("angka dengan pemisah ribuan titik", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1234567)).toBe("1.234.567");
  });

  it("rupiah tanpa desimal", () => {
    expect(formatRupiah(1500)).toMatch(/^Rp\s?1\.500$/);
    expect(formatRupiah(0)).toMatch(/^Rp\s?0$/);
    expect(formatRupiah(1234.56)).toMatch(/^Rp\s?1\.235$/);
  });

  it("rupiah negatif tetap terbaca", () => {
    expect(formatRupiah(-25000)).toMatch(/25\.000/);
    expect(formatRupiah(-25000)).toContain("-");
  });
});

describe("formatDateOnly", () => {
  it("kosong / null -> '-'", () => {
    expect(formatDateOnly(null)).toBe("-");
    expect(formatDateOnly("")).toBe("-");
  });

  it("format tidak valid -> '-'", () => {
    expect(formatDateOnly("bukan-tanggal")).toBe("-");
    expect(formatDateOnly("2026-11")).toBe("-");
    expect(formatDateOnly("0000-00-00")).toBe("-");
  });

  it("tanggal tetap sama (tidak mundur sehari karena zona waktu)", () => {
    // komponen tanggal diparse manual, jadi hasilnya sama di zona waktu mana pun
    const out = formatDateOnly("2026-11-01");
    expect(out).toMatch(/\b1\b/);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Nov/);
  });

  it("batas bulan/tahun", () => {
    expect(formatDateOnly("2026-01-01")).toMatch(/\b1\b.*Jan.*2026/);
    expect(formatDateOnly("2026-12-31")).toMatch(/\b31\b.*Des.*2026/);
  });
});

describe("formatDateTime", () => {
  it("memuat tanggal dan jam", () => {
    const out = formatDateTime("2026-11-05T03:00:00.000Z");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{2}[.:]\d{2}/);
  });
});

describe("formatDelta", () => {
  it("tanda eksplisit untuk arah mutasi", () => {
    expect(formatDelta(5)).toBe("+5");
    expect(formatDelta(-3)).toBe("-3");
    expect(formatDelta(0)).toBe("0");
    expect(formatDelta(1500)).toBe("+1.500");
    expect(formatDelta(-1500)).toBe("-1.500");
  });
});

describe("kelas warna", () => {
  it("deltaColorClass: positif hijau, negatif koral, nol abu-abu", () => {
    expect(deltaColorClass(1)).toContain("lco-green");
    expect(deltaColorClass(-1)).toContain("lco-coral");
    expect(deltaColorClass(0)).toContain("zinc");
  });

  it("movementTypeColorClass: semua jenis mutasi punya kelas", () => {
    const types: StockMovementType[] = [
      "sale", "return", "void", "stock_in", "initial", "opname", "adjustment", "gift",
      "transfer_in", "transfer_out",
    ];
    for (const t of types) {
      expect(movementTypeColorClass(t)).toBeTruthy();
    }
    // barang bertambah = hijau, berkurang karena penyesuaian/hadiah = mustard
    expect(movementTypeColorClass("stock_in")).toContain("lco-green");
    expect(movementTypeColorClass("return")).toContain("lco-green");
    expect(movementTypeColorClass("void")).toContain("lco-green");
    expect(movementTypeColorClass("adjustment")).toContain("lco-mustard");
    expect(movementTypeColorClass("gift")).toContain("lco-mustard");
    expect(movementTypeColorClass("opname")).toContain("sky");
    expect(movementTypeColorClass("transfer_in")).toContain("lco-green");
    expect(movementTypeColorClass("transfer_out")).toContain("lco-mustard");
  });

  it("stockStatusColorClass", () => {
    expect(stockStatusColorClass("habis")).toContain("lco-coral");
    expect(stockStatusColorClass("menipis")).toContain("lco-mustard");
    expect(stockStatusColorClass("aman")).toContain("lco-green");
  });
});

describe("getStockStatus", () => {
  it("stok 0 atau negatif = habis (walau stok minimum 0)", () => {
    expect(getStockStatus(0, 5)).toBe("habis");
    expect(getStockStatus(0, 0)).toBe("habis");
    expect(getStockStatus(-2, 5)).toBe("habis");
  });

  it("stok <= minimum = menipis (batas termasuk), di atasnya aman", () => {
    expect(getStockStatus(5, 5)).toBe("menipis");
    expect(getStockStatus(3, 5)).toBe("menipis");
    expect(getStockStatus(6, 5)).toBe("aman");
  });

  it("minimum 0 dan stok positif = aman", () => {
    expect(getStockStatus(1, 0)).toBe("aman");
  });

  it("label tampilan tersedia untuk semua status", () => {
    expect(STOCK_STATUS_LABEL).toEqual({ habis: "Habis", menipis: "Menipis", aman: "Aman" });
  });
});

describe("toDateInputValue", () => {
  it("YYYY-MM-DD menurut zona waktu perangkat, dengan nol di depan", () => {
    expect(toDateInputValue(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateInputValue(new Date(2026, 10, 25))).toBe("2026-11-25");
  });

  it("jam larut malam tidak menggeser tanggal (bukan UTC)", () => {
    expect(toDateInputValue(new Date(2026, 10, 5, 23, 59, 59))).toBe("2026-11-05");
    expect(toDateInputValue(new Date(2026, 10, 5, 0, 0, 1))).toBe("2026-11-05");
  });
});
