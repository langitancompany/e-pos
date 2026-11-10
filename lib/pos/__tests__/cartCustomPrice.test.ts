import { describe, expect, it } from "vitest";
import {
  addCustomLine,
  addToCart,
  cartItemLabel,
  cartLineKey,
  customLineError,
  getCartSubtotal,
  isCustomPriceProduct,
  removeFromCart,
  updateQty,
} from "../cartLogic";
import { buildSaleReceipt } from "../kasirLogic";
import type { CartItem, Product } from "../types";

function makeCustom(overrides: Partial<Product> = {}): Product {
  return {
    id: "jasa-1",
    sku: "JASA-CETAK",
    barcode: null,
    name: "Jasa Cetak",
    type: "JASA",
    is_service: true,
    is_custom_price: true,
    min_price: 5_000,
    category_id: null,
    unit: "pcs",
    sell_price: 10_000,
    cost_price: null,
    stock: 0,
    min_stock: 0,
    photo_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  } as Product;
}

const input = { price: 7_500, qty: 2, note: "  Undangan 100 lembar  " };

describe("isCustomPriceProduct / addToCart", () => {
  it("hanya produk bertanda is_custom_price", () => {
    expect(isCustomPriceProduct(makeCustom())).toBe(true);
    expect(isCustomPriceProduct(makeCustom({ is_custom_price: false }))).toBe(false);
    expect(isCustomPriceProduct(makeCustom({ is_custom_price: undefined }))).toBe(false);
  });

  it("addToCart tidak memasukkan produk harga bebas dengan harga acuan", () => {
    const cart: CartItem[] = [];
    expect(addToCart(cart, makeCustom())).toBe(cart);
  });
});

describe("customLineError", () => {
  const product = makeCustom();

  it("layak mengembalikan null", () => {
    expect(customLineError(product, input)).toBeNull();
  });

  it("deskripsi kosong atau terlalu panjang", () => {
    expect(customLineError(product, { ...input, note: "   " })).toBe("Deskripsi pesanan wajib diisi.");
    expect(customLineError(product, { ...input, note: "x".repeat(121) })).toContain("maksimal");
  });

  it("jumlah harus bilangan bulat positif", () => {
    expect(customLineError(product, { ...input, qty: 0 })).toContain("Jumlah");
    expect(customLineError(product, { ...input, qty: 1.5 })).toContain("Jumlah");
  });

  it("harga harus positif, bulat, dan tidak di bawah minimum", () => {
    expect(customLineError(product, { ...input, price: 0 })).toContain("lebih dari 0");
    expect(customLineError(product, { ...input, price: 1000.5 })).toContain("lebih dari 0");
    expect(customLineError(product, { ...input, price: 4_999 })).toContain("di bawah");
    expect(customLineError(product, { ...input, price: 5_000 })).toBeNull();
  });

  it("tanpa min_price tidak ada batas bawah selain lebih dari 0", () => {
    expect(customLineError(makeCustom({ min_price: null }), { ...input, price: 1 })).toBeNull();
  });
});

describe("addCustomLine", () => {
  it("menambah baris dengan harga kasir, deskripsi dirapikan, dan lineId", () => {
    const [line] = addCustomLine([], makeCustom(), input, "L1");
    expect(line).toMatchObject({
      lineId: "L1",
      note: "Undangan 100 lembar",
      qty: 2,
    });
    expect(line.product.sell_price).toBe(7_500);
    expect(line.product.id).toBe("jasa-1");
  });

  it("produk yang sama masuk sebagai baris terpisah", () => {
    let cart = addCustomLine([], makeCustom(), input, "L1");
    cart = addCustomLine(cart, makeCustom(), { price: 9_000, qty: 1, note: "Spanduk" }, "L2");
    expect(cart.map(cartLineKey)).toEqual(["L1", "L2"]);
    expect(getCartSubtotal(cart)).toBe(7_500 * 2 + 9_000);
  });

  it("input tidak valid, produk nonaktif, atau produk biasa mengembalikan cart yang sama", () => {
    const cart: CartItem[] = [];
    expect(addCustomLine(cart, makeCustom(), { ...input, price: 100 })).toBe(cart);
    expect(addCustomLine(cart, makeCustom({ is_active: false }), input)).toBe(cart);
    expect(addCustomLine(cart, makeCustom({ is_custom_price: false }), input)).toBe(cart);
  });

  it("harga acuan produk tidak berubah oleh baris keranjang", () => {
    const product = makeCustom();
    addCustomLine([], product, input, "L1");
    expect(product.sell_price).toBe(10_000);
  });
});

describe("updateQty / removeFromCart memakai kunci baris", () => {
  const base = addCustomLine(
    addCustomLine([], makeCustom(), input, "L1"),
    makeCustom(),
    { price: 9_000, qty: 1, note: "Spanduk" },
    "L2",
  );

  it("updateQty hanya mengubah baris yang dituju", () => {
    const next = updateQty(base, "L2", 2);
    expect(next.map((i) => i.qty)).toEqual([2, 3]);
  });

  it("removeFromCart hanya menghapus baris yang dituju", () => {
    expect(removeFromCart(base, "L1").map(cartLineKey)).toEqual(["L2"]);
  });

  it("baris biasa tetap memakai id produk sebagai kunci", () => {
    const regular: CartItem = { product: makeCustom({ id: "p9", is_custom_price: false }), qty: 1 };
    expect(cartLineKey(regular)).toBe("p9");
    expect(removeFromCart([regular], "p9")).toEqual([]);
  });
});

describe("cartItemLabel dan struk", () => {
  it("label menyertakan deskripsi bila ada", () => {
    const [line] = addCustomLine([], makeCustom(), input, "L1");
    expect(cartItemLabel(line)).toBe("Jasa Cetak: Undangan 100 lembar");
    expect(cartItemLabel({ product: makeCustom({ is_custom_price: false }), qty: 1 })).toBe("Jasa Cetak");
  });

  it("struk memakai harga kasir dan label berisi deskripsi", () => {
    const cart = addCustomLine([], makeCustom(), input, "L1");
    const receipt = buildSaleReceipt({
      branding: {},
      receiptNo: "R1",
      createdAt: "2026-11-10T00:00:00Z",
      cashierName: null,
      customerName: undefined,
      cart,
      subtotal: 15_000,
      discount: 0,
      tax: 0,
      total: 15_000,
      paidAmount: 15_000,
      changeAmount: 0,
      method: "Tunai",
    });
    expect(receipt.items).toEqual([
      { name: "Jasa Cetak: Undangan 100 lembar", price: 7_500, qty: 2 },
    ]);
  });
});
