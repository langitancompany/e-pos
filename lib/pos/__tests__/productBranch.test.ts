import { describe, expect, it } from "vitest";
import {
  applyBranchRow,
  availabilityLabel,
  availabilityOf,
  isMissingBranchInventoryError,
  normalizeProductBranchRow,
  overlayBranchProducts,
  validateBranchSetup,
  validateTransfer,
  type ProductBranchRow,
} from "../productBranch";
import type { Product } from "../types";

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: `SKU-${id}`,
  barcode: null,
  name: `Produk ${id}`,
  type: "MERCHANDISE",
  is_service: false,
  category_id: null,
  unit: "pcs",
  sell_price: 10000,
  cost_price: 5000,
  stock: 99,
  min_stock: 9,
  photo_url: null,
  is_active: true,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  ...over,
});

const row = (productId: string, over: Partial<ProductBranchRow> = {}): ProductBranchRow => ({
  product_id: productId,
  branch_id: "b1",
  stock: 4,
  min_stock: 2,
  price_override: null,
  is_active: true,
  ...over,
});

describe("normalizeProductBranchRow", () => {
  it("mengubah angka berbentuk teks dan menjaga null", () => {
    const r = normalizeProductBranchRow({
      product_id: "p1",
      branch_id: "b1",
      stock: "7",
      min_stock: 3,
      price_override: null,
      is_active: true,
    });
    expect(r.stock).toBe(7);
    expect(r.price_override).toBeNull();
  });

  it("menganggap harga khusus 0 sebagai tidak ada", () => {
    expect(normalizeProductBranchRow({ product_id: "p", branch_id: "b", price_override: 0 }).price_override).toBeNull();
  });

  it("is_active default true", () => {
    expect(normalizeProductBranchRow({ product_id: "p", branch_id: "b" }).is_active).toBe(true);
  });
});

describe("availabilityOf", () => {
  it("membedakan tersedia, nonaktif, dan belum diaktifkan", () => {
    expect(availabilityOf(row("p"))).toBe("available");
    expect(availabilityOf(row("p", { is_active: false }))).toBe("inactive");
    expect(availabilityOf(undefined)).toBe("unlisted");
    expect(availabilityLabel("unlisted")).toBe("Belum diaktifkan");
  });
});

describe("applyBranchRow", () => {
  it("memakai stok dan minimum outlet, bukan angka master", () => {
    const p = applyBranchRow(product("p1"), row("p1"));
    expect(p.stock).toBe(4);
    expect(p.min_stock).toBe(2);
  });

  it("memakai harga khusus outlet dan menyimpan harga master", () => {
    const p = applyBranchRow(product("p1"), row("p1", { price_override: 12000 }));
    expect(p.sell_price).toBe(12000);
    expect(p.base_sell_price).toBe(10000);
    expect(p.branch_price_override).toBe(12000);
  });

  it("memakai harga master kalau tidak ada harga khusus", () => {
    expect(applyBranchRow(product("p1"), row("p1")).sell_price).toBe(10000);
  });

  it("produk belum diaktifkan: stok 0 dan tidak aktif", () => {
    const p = applyBranchRow(product("p1"), undefined);
    expect(p.stock).toBe(0);
    expect(p.is_active).toBe(false);
    expect(p.branch_availability).toBe("unlisted");
  });

  it("produk nonaktif global tetap nonaktif walau aktif di outlet", () => {
    expect(applyBranchRow(product("p1", { is_active: false }), row("p1")).is_active).toBe(false);
  });

  it("produk jasa selalu berstok 0", () => {
    const p = applyBranchRow(product("j", { type: "JASA", is_service: true }), row("j", { stock: 5 }));
    expect(p.stock).toBe(0);
    expect(p.min_stock).toBe(0);
  });

  it("tidak mengubah objek asli", () => {
    const original = product("p1");
    applyBranchRow(original, row("p1", { price_override: 1 }));
    expect(original.stock).toBe(99);
  });
});

describe("overlayBranchProducts", () => {
  const products = [product("a"), product("b"), product("c")];
  const rows = [row("a"), row("b", { is_active: false })];

  it("mode kasir hanya mengembalikan produk tersedia", () => {
    expect(overlayBranchProducts(products, rows, true).map((p) => p.id)).toEqual(["a"]);
  });

  it("mode admin mengembalikan semua produk dengan statusnya", () => {
    const out = overlayBranchProducts(products, rows, false);
    expect(out.map((p) => p.branch_availability)).toEqual(["available", "inactive", "unlisted"]);
  });
});

describe("isMissingBranchInventoryError", () => {
  it("mengenali tabel/fungsi yang belum ada", () => {
    expect(isMissingBranchInventoryError({ code: "42P01" })).toBe(true);
    expect(isMissingBranchInventoryError({ code: "PGRST205" })).toBe(true);
    expect(isMissingBranchInventoryError({ message: "relation e_pos.product_branches does not exist" })).toBe(true);
  });

  it("mengabaikan error lain dan null", () => {
    expect(isMissingBranchInventoryError({ message: "network down" })).toBe(false);
    expect(isMissingBranchInventoryError(null)).toBe(false);
  });
});

describe("validateBranchSetup", () => {
  const ok = { stock: 0, minStock: 0, priceOverride: null, isService: false };

  it("menerima isian wajar", () => {
    expect(validateBranchSetup(ok)).toBeNull();
    expect(validateBranchSetup({ ...ok, stock: 10, minStock: 2, priceOverride: 9000 })).toBeNull();
  });

  it("menolak stok negatif atau pecahan", () => {
    expect(validateBranchSetup({ ...ok, stock: -1 })).toMatch(/Stok awal/);
    expect(validateBranchSetup({ ...ok, stock: 1.5 })).toMatch(/Stok awal/);
  });

  it("menolak stok untuk produk jasa", () => {
    expect(validateBranchSetup({ ...ok, isService: true, stock: 1 })).toMatch(/jasa/);
  });

  it("menolak minimum negatif dan harga 0", () => {
    expect(validateBranchSetup({ ...ok, minStock: -1 })).toMatch(/Minimum/);
    expect(validateBranchSetup({ ...ok, priceOverride: 0 })).toMatch(/Harga/);
  });
});

describe("validateTransfer", () => {
  const line = { productId: "p1", qty: 2, available: 5, name: "Kopi" };

  it("menerima transfer yang valid", () => {
    expect(validateTransfer("a", "b", [line])).toBeNull();
  });

  it("menolak outlet kosong atau sama", () => {
    expect(validateTransfer(null, "b", [line])).toMatch(/asal/);
    expect(validateTransfer("a", null, [line])).toMatch(/tujuan/);
    expect(validateTransfer("a", "a", [line])).toMatch(/berbeda/);
  });

  it("menolak daftar kosong", () => {
    expect(validateTransfer("a", "b", [])).toMatch(/minimal satu/);
  });

  it("menolak jumlah tidak valid dan melebihi stok", () => {
    expect(validateTransfer("a", "b", [{ ...line, qty: 0 }])).toMatch(/lebih dari 0/);
    expect(validateTransfer("a", "b", [{ ...line, qty: 6 }])).toMatch(/tidak cukup/);
  });

  it("menolak produk ganda", () => {
    expect(validateTransfer("a", "b", [line, line])).toMatch(/lebih dari sekali/);
  });
});
