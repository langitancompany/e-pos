import { describe, expect, it } from "vitest";
import {
  addToCart,
  clearCart,
  formatRupiah,
  getAvailableStock,
  getCartItemCount,
  getCartSubtotal,
  isOutOfStock,
  removeFromCart,
  updateQty,
} from "../cartLogic";
import type { CartItem, Product } from "../types";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    sku: "SKU-1",
    barcode: null,
    name: "Produk Uji",
    type: "RETAIL" as Product["type"],
    is_service: false,
    category_id: null,
    unit: "pcs",
    sell_price: 10_000,
    cost_price: 6_000,
    stock: 5,
    min_stock: 1,
    photo_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("getAvailableStock / isOutOfStock", () => {
  it("memakai stok produk biasa", () => {
    expect(getAvailableStock(makeProduct({ stock: 3 }))).toBe(3);
    expect(isOutOfStock(makeProduct({ stock: 3 }))).toBe(false);
    expect(isOutOfStock(makeProduct({ stock: 0 }))).toBe(true);
  });

  it("produk jasa tidak dibatasi stok", () => {
    const jasa = makeProduct({ is_service: true, stock: 0 });
    expect(getAvailableStock(jasa)).toBe(Infinity);
    expect(isOutOfStock(jasa)).toBe(false);
  });
});

describe("addToCart", () => {
  it("menambah produk baru dengan qty 1", () => {
    const cart = addToCart([], makeProduct());
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(1);
  });

  it("menaikkan qty bila produk sudah ada, tanpa mengubah cart lama", () => {
    const product = makeProduct();
    const before = addToCart([], product);
    const after = addToCart(before, product);
    expect(after[0].qty).toBe(2);
    expect(before[0].qty).toBe(1); // immutable
  });

  it("tidak melebihi stok", () => {
    const product = makeProduct({ stock: 2 });
    let cart: CartItem[] = [];
    cart = addToCart(cart, product);
    cart = addToCart(cart, product);
    const capped = addToCart(cart, product);
    expect(capped[0].qty).toBe(2);
    expect(capped).toBe(cart); // no-op mengembalikan referensi yang sama
  });

  it("menolak produk nonaktif dan produk stok habis", () => {
    expect(addToCart([], makeProduct({ is_active: false }))).toEqual([]);
    expect(addToCart([], makeProduct({ stock: 0 }))).toEqual([]);
  });

  it("produk jasa boleh ditambah berulang walau stok 0", () => {
    const jasa = makeProduct({ is_service: true, stock: 0 });
    let cart = addToCart([], jasa);
    cart = addToCart(cart, jasa);
    cart = addToCart(cart, jasa);
    expect(cart[0].qty).toBe(3);
  });
});

describe("updateQty", () => {
  const product = makeProduct({ stock: 3 });
  const cart: CartItem[] = [{ product, qty: 2 }];

  it("menaikkan dan menurunkan qty", () => {
    expect(updateQty(cart, "p1", 1)[0].qty).toBe(3);
    expect(updateQty(cart, "p1", -1)[0].qty).toBe(1);
  });

  it("tidak turun di bawah 1 dan tidak melebihi stok", () => {
    expect(updateQty(cart, "p1", -2)[0].qty).toBe(2);
    expect(updateQty(cart, "p1", 2)[0].qty).toBe(2);
  });

  it("mengabaikan id yang tidak ada", () => {
    expect(updateQty(cart, "tidak-ada", 1)).toEqual(cart);
  });
});

describe("removeFromCart / clearCart", () => {
  it("menghapus item sesuai id", () => {
    const a = makeProduct({ id: "a" });
    const b = makeProduct({ id: "b" });
    const cart: CartItem[] = [
      { product: a, qty: 1 },
      { product: b, qty: 1 },
    ];
    expect(removeFromCart(cart, "a").map((i) => i.product.id)).toEqual(["b"]);
  });

  it("clearCart mengembalikan array kosong", () => {
    expect(clearCart()).toEqual([]);
  });
});

describe("getCartSubtotal / getCartItemCount", () => {
  const cart: CartItem[] = [
    { product: makeProduct({ id: "a", sell_price: 10_000 }), qty: 2 },
    { product: makeProduct({ id: "b", sell_price: 2_500 }), qty: 3 },
  ];

  it("menjumlah harga × qty", () => {
    expect(getCartSubtotal(cart)).toBe(27_500);
    expect(getCartSubtotal([])).toBe(0);
  });

  it("menjumlah total unit", () => {
    expect(getCartItemCount(cart)).toBe(5);
    expect(getCartItemCount([])).toBe(0);
  });
});

describe("formatRupiah", () => {
  it("memakai pemisah ribuan titik dan tanpa desimal", () => {
    expect(formatRupiah(1_250_000)).toMatch(/^Rp\s?1\.250\.000$/);
    expect(formatRupiah(0)).toMatch(/^Rp\s?0$/);
  });
});
