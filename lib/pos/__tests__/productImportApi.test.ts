import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../productLogic", () => ({ createProduct: vi.fn() }));

import { createProduct } from "../productLogic";
import { importProducts, toCreateInput } from "../productImportApi";
import type { ImportRow, ParsedProduct } from "../productImport";

const product = (patch: Partial<ParsedProduct> = {}): ParsedProduct => ({
  name: "Kaos",
  sku: "KP-1",
  barcode: "2000000000015",
  barcodeAuto: true,
  type: "FASHION",
  categoryId: "c1",
  categoryName: "Pakaian",
  unit: "pcs",
  sellPrice: 75000,
  costPrice: 40000,
  stock: 10,
  minStock: 2,
  isActive: true,
  ...patch,
});

const okRow = (rowNumber: number, patch: Partial<ParsedProduct> = {}): ImportRow => ({
  rowNumber,
  label: `Produk ${rowNumber}`,
  errors: [],
  product: product({ sku: `SKU-${rowNumber}`, ...patch }),
});

beforeEach(() => {
  vi.mocked(createProduct).mockReset();
  vi.mocked(createProduct).mockResolvedValue({ success: true, product: { id: "p" } });
});

describe("toCreateInput", () => {
  it("memetakan produk hasil parsing ke input createProduct", () => {
    expect(toCreateInput(product(), "b1")).toEqual({
      name: "Kaos",
      sku: "KP-1",
      barcode: "2000000000015",
      type: "FASHION",
      category_id: "c1",
      unit: "pcs",
      sell_price: 75000,
      cost_price: 40000,
      stock: 10,
      min_stock: 2,
      photo_url: "",
      is_active: true,
      is_extra_charge: false,
      branch_id: "b1",
    });
  });

  it("tanpa kategori jadi string kosong; KEMASAN tampil di Biaya Tambahan", () => {
    const input = toCreateInput(product({ categoryId: null, type: "KEMASAN" }), null);
    expect(input.category_id).toBe("");
    expect(input.is_extra_charge).toBe(true);
    expect(input.branch_id).toBeNull();
  });
});

describe("importProducts", () => {
  it("menyimpan hanya baris valid dan melaporkan progres", async () => {
    const bad: ImportRow = { rowNumber: 3, label: "x", errors: ["salah"], product: null };
    const progress: number[] = [];
    const outcomes = await importProducts([okRow(2), bad, okRow(4)], {
      branchId: "b1",
      onProgress: (done) => progress.push(done),
    });
    expect(createProduct).toHaveBeenCalledTimes(2);
    expect(outcomes.map((o) => o.rowNumber)).toEqual([2, 4]);
    expect(outcomes.every((o) => o.success)).toBe(true);
    expect(progress.sort()).toEqual([1, 2]);
  });

  it("satu baris gagal tidak menghentikan yang lain, error diteruskan", async () => {
    vi.mocked(createProduct)
      .mockResolvedValueOnce({ success: false, error: "SKU tersebut sudah digunakan." })
      .mockResolvedValue({ success: true, product: { id: "p" }, warning: "stok awal tidak tercatat" });
    const outcomes = await importProducts([okRow(2), okRow(3)], { branchId: null, concurrency: 1 });
    expect(outcomes[0]).toMatchObject({ rowNumber: 2, success: false, error: "SKU tersebut sudah digunakan." });
    expect(outcomes[1]).toMatchObject({ rowNumber: 3, success: true, warning: "stok awal tidak tercatat" });
  });

  it("exception dari createProduct jadi hasil gagal", async () => {
    vi.mocked(createProduct).mockRejectedValue(new Error("jaringan putus"));
    const [outcome] = await importProducts([okRow(2)], { branchId: null });
    expect(outcome).toMatchObject({ success: false, error: "jaringan putus" });
  });

  it("tanpa baris valid tidak memanggil apa pun", async () => {
    expect(await importProducts([], { branchId: null })).toEqual([]);
    expect(createProduct).not.toHaveBeenCalled();
  });
});
