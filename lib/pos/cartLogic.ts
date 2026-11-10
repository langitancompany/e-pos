// lib/pos/cartLogic.ts
// ── TAMBAHAN ── Logika bisnis murni untuk Keranjang Kasir (PRD §7: logika di /lib, bukan di komponen).
// Semua fungsi di sini tidak menyentuh React state — menerima cart lama, mengembalikan cart baru.

import { CartItem, Product } from "./types";

/**
 * Stok efektif suatu produk untuk validasi keranjang.
 * Produk tipe JASA (is_service = true) qty-nya tidak terbatas oleh stok (PRD §4.3).
 */
export function getAvailableStock(product: Product): number {
  if (product.is_service) return Infinity;
  return product.stock;
}

export function isOutOfStock(product: Product): boolean {
  if (product.is_service) return false;
  return product.stock <= 0;
}

/**
 * Tambah 1 produk ke keranjang. Jika sudah ada, qty +1 (dibatasi stok tersedia).
 * Jika produk nonaktif atau stok tidak cukup, cart dikembalikan apa adanya (no-op).
 */
export function addToCart(cart: CartItem[], product: Product): CartItem[] {
  if (!product.is_active) return cart;
  // Produk harga bebas tidak punya harga tetap: masuk lewat addCustomLine setelah kasir mengisi harga.
  if (isCustomPriceProduct(product)) return cart;

  const existing = cart.find((item) => item.product.id === product.id);
  const available = getAvailableStock(product);

  if (existing) {
    if (existing.qty >= available) return cart;
    return cart.map((item) =>
      item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item,
    );
  }

  if (available <= 0) return cart;
  return [...cart, { product, qty: 1 }];
}

/**
 * Ubah qty item di keranjang sebesar `delta` (bisa negatif).
 * Qty tidak pernah turun di bawah 1 (pakai removeFromCart untuk menghapus) atau melebihi stok tersedia.
 */
export function updateQty(
  cart: CartItem[],
  lineKey: string,
  delta: number,
): CartItem[] {
  return cart.map((item) => {
    if (cartLineKey(item) !== lineKey) return item;

    const available = getAvailableStock(item.product);
    const newQty = item.qty + delta;

    if (newQty < 1 || newQty > available) return item;
    return { ...item, qty: newQty };
  });
}

export function removeFromCart(cart: CartItem[], lineKey: string): CartItem[] {
  return cart.filter((item) => cartLineKey(item) !== lineKey);
}

// ───────────────────────── Produk harga bebas ─────────────────────────

export const CUSTOM_NOTE_MAX_LENGTH = 120;
export const CUSTOM_MAX_QTY = 99999;

export function isCustomPriceProduct(product: Product): boolean {
  return product.is_custom_price === true;
}

/** Kunci baris keranjang: id produk, atau lineId untuk baris harga bebas. */
export function cartLineKey(item: CartItem): string {
  return item.lineId ?? item.product.id;
}

/** Nama baris untuk struk dan daftar: "Nama Produk: deskripsi" bila ada deskripsi. */
export function cartItemLabel(item: CartItem): string {
  return item.note ? `${item.product.name}: ${item.note}` : item.product.name;
}

export interface CustomLineInput {
  price: number;
  qty: number;
  note: string;
}

/** Pesan error untuk isian harga bebas, null kalau layak. Aturan harga minimum sama dengan server. */
export function customLineError(
  product: Product,
  input: CustomLineInput,
): string | null {
  if (!input.note.trim()) return "Deskripsi pesanan wajib diisi.";
  if (input.note.trim().length > CUSTOM_NOTE_MAX_LENGTH) {
    return `Deskripsi maksimal ${CUSTOM_NOTE_MAX_LENGTH} karakter.`;
  }
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > CUSTOM_MAX_QTY) {
    return "Jumlah harus bilangan bulat lebih dari 0.";
  }
  if (!Number.isInteger(input.price) || input.price <= 0) {
    return "Harga satuan harus lebih dari 0.";
  }
  if (product.min_price != null && input.price < product.min_price) {
    return `Harga satuan tidak boleh di bawah ${formatRupiah(product.min_price)}.`;
  }
  return null;
}

let lineCounter = 0;

export function newLineId(): string {
  lineCounter += 1;
  return `line-${Date.now().toString(36)}-${lineCounter}`;
}

/**
 * Tambah baris harga bebas. Selalu baris baru, tidak digabung dengan baris lain,
 * karena tiap pesanan punya deskripsi dan harga sendiri. Input tidak valid
 * mengembalikan cart apa adanya.
 */
export function addCustomLine(
  cart: CartItem[],
  product: Product,
  input: CustomLineInput,
  lineId: string = newLineId(),
): CartItem[] {
  if (!product.is_active || !isCustomPriceProduct(product)) return cart;
  if (customLineError(product, input)) return cart;

  return [
    ...cart,
    {
      product: { ...product, sell_price: input.price },
      qty: input.qty,
      lineId,
      note: input.note.trim(),
    },
  ];
}

export function clearCart(): CartItem[] {
  return [];
}

/** Subtotal = jumlah (harga jual eceran × qty) semua item, sebelum diskon/pajak. */
export function getCartSubtotal(cart: CartItem[]): number {
  return cart.reduce(
    (sum, item) => sum + item.product.sell_price * item.qty,
    0,
  );
}

/** Total jumlah unit di keranjang (untuk badge "X Item"). */
export function getCartItemCount(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

/** Format angka menjadi Rupiah, dipakai di semua tempat yang menampilkan uang. */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}