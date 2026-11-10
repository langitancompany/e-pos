// lib/pos/kasirLogic.ts
// ── Dipecah dari app/components/kasir/KasirModule.tsx. Logika murni layar Kasir
// (tanpa React & tanpa Supabase) dipindah APA ADANYA supaya bisa dites di
// environment node: hitung pajak/diskon poin, cari produk dari kode/barcode,
// filter produk & pelanggan, dan penyusunan data struk.

import type { CartItem, Product } from "./types";
import { cartItemLabel, getAvailableStock, isOutOfStock } from "./cartLogic";
import type { ReceiptData } from "./printLogic";
import type { PaymentMethod, SplitPaymentLine } from "./transactionApi";

// ── Label singkat per metode, dipakai untuk menyusun field `method` gabungan di
// struk split payment (mis. "Tunai + Digital"). Disamakan dengan METHODS /
// PREVIEW_METHOD_LABELS di PaymentModal.tsx (migration 034: metode bayar = 3).
export const SPLIT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Tunai",
  DIGITAL: "Digital",
  TEMPO: "Piutang",
};

// =====================================================================
// Angka & total
// =====================================================================

/** Ambil angka dari input teks (buang semua non-digit). Kosong/invalid -> 0. */
export function parseDigits(input: string): number {
  return Number(input.replace(/[^0-9]/g, "")) || 0;
}

/** PPN dibulatkan ke rupiah terdekat. 0 kalau PPN dimatikan. */
export function calcTax(
  subtotal: number,
  ppnEnabled: boolean,
  ppnRate: number,
): number {
  if (!ppnEnabled) return 0;
  return Math.round((subtotal * ppnRate) / 100);
}

/**
 * Poin loyalitas yang benar-benar dipakai. Dibatasi supaya potongannya tidak
 * pernah melebihi subtotal+pajak (total tidak pernah negatif) dan tidak
 * melebihi saldo poin pelanggan. 0 kalau loyalitas mati / poin tidak dipakai /
 * tidak ada pelanggan terpilih (`customerPoints === null`).
 */
export function calcPointsBeingUsed(params: {
  loyaltyEnabled: boolean;
  usePoints: boolean;
  customerPoints: number | null;
  subtotal: number;
  tax: number;
  pointValue: number;
}): number {
  const { loyaltyEnabled, usePoints, customerPoints, subtotal, tax, pointValue } =
    params;
  if (!loyaltyEnabled || !usePoints || customerPoints === null) return 0;
  const maxAffordablePoints = Math.floor((subtotal + tax) / pointValue);
  return Math.min(customerPoints, maxAffordablePoints);
}

/**
 * Diskon gabungan dari 2 sumber ADDITIF: potongan poin loyalitas + diskon
 * manual kasir. Total dibatasi supaya tidak melebihi subtotal+pajak; kalau
 * poin sudah memotong duluan, sisa kuota diskon manual otomatis mengecil.
 */
export function calcDiscount(params: {
  pointsBeingUsed: number;
  pointValue: number;
  manualDiscount: number;
  subtotal: number;
  tax: number;
}): number {
  const { pointsBeingUsed, pointValue, manualDiscount, subtotal, tax } = params;
  const loyaltyPart = pointsBeingUsed * pointValue;
  const remainingCap = Math.max(subtotal + tax - loyaltyPart, 0);
  return loyaltyPart + Math.min(manualDiscount, remainingCap);
}

export function calcGrandTotal(
  subtotal: number,
  discount: number,
  tax: number,
): number {
  return subtotal - discount + tax;
}

// =====================================================================
// Pencarian & filter
// =====================================================================

type ProductSearchable = Pick<
  Product,
  "name" | "sku" | "barcode" | "category_id"
>;

/** Filter katalog: kategori (null = semua) + teks (nama / SKU / barcode, case-insensitive, "includes"). */
export function filterProducts<T extends ProductSearchable>(
  products: T[],
  searchQuery: string,
  selectedCategoryId: string | null,
): T[] {
  const q = searchQuery.trim().toLowerCase();
  return products.filter((product) => {
    const matchesCategory =
      !selectedCategoryId || product.category_id === selectedCategoryId;
    const matchesSearch =
      !q ||
      product.name.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      (product.barcode ?? "").toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });
}

/**
 * Item untuk modal Biaya Tambahan (migration 045/046): produk Jasa SELALU
 * tampil; barang berstok tampil kalau ditandai "Tampilkan di Biaya Tambahan"
 * atau bertipe KEMASAN.
 */
export function filterServiceProducts<
  T extends Pick<Product, "is_service" | "type"> & { is_extra_charge?: boolean },
>(products: T[]): T[] {
  return products.filter(
    (p) => p.is_service || p.is_extra_charge || p.type === "KEMASAN",
  );
}

/**
 * Pencarian pelanggan: dipecah per-kata (mis. "muhammad ahmad" cocok dengan
 * "Ahmad Muhammad Rizki") dan juga mencari di no. HP. Query kosong -> [].
 */
export function filterCustomers<
  T extends { name: string; phone: string | null },
>(customers: T[], query: string, limit = 12): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return customers
    .filter((c) => {
      const hay = `${c.name} ${c.phone ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, limit);
}

// =====================================================================
// Kode produk (mode PC) & scan barcode (kamera)
// =====================================================================

export type PcCodeResult<T> =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "found"; product: T; qty: number };

/**
 * Kolom "Jumlah Beli * Kode" mode PC: boleh polos (SKU/barcode) atau pintas
 * "qty*kode" (mis. "3*p1"). Dicocokkan PERSIS (bukan includes) ke SKU, lalu
 * barcode, case-insensitive. Input kosong -> { kind: "empty" } (tidak ada aksi).
 */
export function resolvePcCode<T extends Pick<Product, "sku" | "barcode">>(
  products: T[],
  raw: string,
): PcCodeResult<T> {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };

  let qty = 1;
  let code = trimmed;
  const starIdx = trimmed.indexOf("*");
  if (starIdx > -1) {
    const qtyPart = trimmed.slice(0, starIdx).trim();
    const codePart = trimmed.slice(starIdx + 1).trim();
    const parsedQty = Number(qtyPart);
    if (qtyPart && Number.isFinite(parsedQty) && parsedQty > 0) {
      qty = Math.floor(parsedQty);
      code = codePart;
    }
  }

  if (!code) return { kind: "error", message: "Kode tidak boleh kosong." };

  const lower = code.toLowerCase();
  const product = products.find(
    (p) =>
      p.sku.toLowerCase() === lower ||
      (p.barcode ?? "").toLowerCase() === lower,
  );

  if (!product) {
    return {
      kind: "error",
      message: `Produk dengan kode "${code}" tidak ditemukan.`,
    };
  }

  return { kind: "found", product, qty };
}

export interface ScanFeedbackData {
  type: "success" | "error";
  message: string;
}

export interface ScanResolution<T> {
  feedback: ScanFeedbackData;
  /** Terisi hanya kalau scan sukses dan produk harus ditambahkan ke keranjang. */
  productToAdd?: T;
}

/**
 * Hasil scan satu barcode kamera. Dicocokkan ke barcode DULU (persis), baru
 * SKU (persis, case-insensitive) — label cetak memakai barcode, atau SKU kalau
 * barcode kosong. Menolak produk tak ditemukan / stok habis / sudah mencapai
 * stok maksimal di keranjang.
 */
export function resolveBarcodeScan<T extends Product>(
  products: T[],
  cart: CartItem[],
  rawCode: string,
): ScanResolution<T> {
  const code = rawCode.trim();
  const lowerCode = code.toLowerCase();
  const product =
    products.find((p) => (p.barcode ?? "").trim() === code) ??
    products.find((p) => p.sku.trim().toLowerCase() === lowerCode);

  if (!product) {
    return {
      feedback: {
        type: "error",
        message: `Barcode "${code}" tidak ditemukan di daftar produk.`,
      },
    };
  }
  if (isOutOfStock(product)) {
    return {
      feedback: { type: "error", message: `${product.name} — stok habis.` },
    };
  }
  const inCartQty =
    cart.find((item) => item.product.id === product.id)?.qty ?? 0;
  if (inCartQty >= getAvailableStock(product)) {
    return {
      feedback: {
        type: "error",
        message: `${product.name} — sudah mencapai stok maksimal di keranjang.`,
      },
    };
  }
  return {
    feedback: {
      type: "success",
      message: `${product.name} ditambahkan ke keranjang.`,
    },
    productToAdd: product,
  };
}

// =====================================================================
// Struk
// =====================================================================

/** Ringkasan pembayaran split: total semua baris + label metode gabungan ("Tunai + Digital"). */
export function summarizeSplitPayment(lines: SplitPaymentLine[]): {
  totalPaid: number;
  methodLabel: string;
} {
  return {
    totalPaid: lines.reduce((sum, line) => sum + line.amount, 0),
    methodLabel: lines
      .map((line) => SPLIT_METHOD_LABELS[line.method] ?? line.method)
      .join(" + "),
  };
}

/** Struk penjualan. `branding` = nama toko/alamat/telepon/footer/header/promo dari Pengaturan. */
export function buildSaleReceipt(params: {
  branding: Partial<ReceiptData>;
  receiptNo: string;
  createdAt: string;
  cashierName: string | null;
  customerName: string | undefined;
  cart: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  method: string;
}): ReceiptData {
  return {
    ...params.branding,
    receiptNo: params.receiptNo,
    createdAt: params.createdAt,
    cashierName: params.cashierName,
    customerName: params.customerName,
    items: params.cart.map((item) => ({
      name: cartItemLabel(item),
      price: item.product.sell_price,
      qty: item.qty,
    })),
    subtotal: params.subtotal,
    discount: params.discount,
    tax: params.tax,
    total: params.total,
    paidAmount: params.paidAmount,
    changeAmount: params.changeAmount,
    method: params.method,
  };
}

/**
 * Struk Buka Kasir (`kind: "shift_open"`): layout sendiri, tanpa item.
 * Field wajib lain di ReceiptData hanya pengisi tipe, tidak tercetak.
 */
export function buildShiftOpenReceipt(params: {
  branding: Partial<ReceiptData>;
  now: Date;
  cashierName: string | null;
  openingCash: number;
}): ReceiptData {
  const { branding, now, cashierName, openingCash } = params;
  return {
    ...branding,
    receiptNo: `BUKA-${now.getTime()}`,
    createdAt: now.toISOString(),
    cashierName,
    kind: "shift_open",
    openingCash,
    items: [],
    subtotal: openingCash,
    discount: 0,
    tax: 0,
    total: openingCash,
    paidAmount: openingCash,
    changeAmount: 0,
    method: "Buka Kasir",
  };
}

/**
 * Struk Tutup Sesi Kas (`kind: "shift_close"`): layout sendiri, tanpa item.
 * Dicetak SETELAH sesi tertutup, jadi memuat kas seharusnya & selisih.
 */
export function buildShiftCloseReceipt(params: {
  branding: Partial<ReceiptData>;
  now: Date;
  cashierName: string | null;
  openedAt: string | null;
  result: {
    shift_id: string;
    opening_cash: number;
    cash_sales: number;
    cash_refunds: number;
    cash_in: number;
    cash_out: number;
    expected_cash: number;
    actual_cash: number;
    difference: number;
    notes: string | null;
  };
}): ReceiptData {
  const { branding, now, cashierName, openedAt, result } = params;
  return {
    ...branding,
    receiptNo: `TUTUP-${now.getTime()}`,
    createdAt: now.toISOString(),
    cashierName,
    kind: "shift_close",
    openingCash: result.opening_cash,
    shiftClose: {
      openedAt,
      cashSales: result.cash_sales,
      cashRefunds: result.cash_refunds,
      cashIn: result.cash_in,
      cashOut: result.cash_out,
      expectedCash: result.expected_cash,
      actualCash: result.actual_cash,
      difference: result.difference,
      notes: result.notes,
    },
    items: [],
    subtotal: result.actual_cash,
    discount: 0,
    tax: 0,
    total: result.actual_cash,
    paidAmount: result.actual_cash,
    changeAmount: 0,
    method: "Tutup Kasir",
  };
}
