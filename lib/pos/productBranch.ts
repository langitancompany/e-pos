// Produk, harga, dan stok per outlet (migration 052). Fungsi murni, tanpa akses jaringan.

import type { BranchAvailability, Product } from "./types";

export interface ProductBranchRow {
  product_id: string;
  branch_id: string;
  stock: number;
  min_stock: number;
  price_override: number | null;
  is_active: boolean;
}

export const PRODUCT_BRANCH_COLUMNS =
  "product_id, branch_id, stock, min_stock, price_override, is_active";

export function normalizeProductBranchRow(row: Record<string, unknown>): ProductBranchRow {
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    product_id: String(row.product_id),
    branch_id: String(row.branch_id),
    stock: num(row.stock, 0),
    min_stock: num(row.min_stock, 0),
    price_override:
      row.price_override === null || row.price_override === undefined
        ? null
        : num(row.price_override, 0) || null,
    is_active: row.is_active !== false,
  };
}

/** Error Postgres/PostgREST karena migration 052 belum dijalankan. */
export function isMissingBranchInventoryError(
  err: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202") return true;
  return /product_branches|assign_product_branch|transfer_stock/.test(err.message ?? "");
}

export function availabilityOf(row: ProductBranchRow | undefined): BranchAvailability {
  if (!row) return "unlisted";
  return row.is_active ? "available" : "inactive";
}

/**
 * Timpa stok, minimum, harga, dan status aktif produk dengan data outlet.
 * Produk jasa tidak punya stok, jadi angkanya dibiarkan 0.
 */
export function applyBranchRow<T extends Product>(product: T, row: ProductBranchRow | undefined): T {
  const availability = availabilityOf(row);
  const isService = product.is_service || product.type === "JASA";
  return {
    ...product,
    base_sell_price: product.sell_price,
    branch_availability: availability,
    branch_price_override: row?.price_override ?? null,
    sell_price: row?.price_override ?? product.sell_price,
    stock: isService ? 0 : (row?.stock ?? 0),
    min_stock: isService ? 0 : (row?.min_stock ?? 0),
    is_active: product.is_active && availability === "available",
  };
}

/**
 * "available" = hanya produk yang tampil di kasir outlet (layar Kasir).
 * "listed"    = semua produk yang sudah dipasang di outlet, termasuk yang dinonaktifkan
 *               di sana (layar Produk, Stok, Hadiah). Produk yang tidak
 *               pernah dipasang di outlet tidak ikut, jadi tidak muncul sebagai baris
 *               berstok 0.
 */
export type BranchProductScope = "available" | "listed";

/** Gabungkan master produk dengan baris outlet, lalu saring sesuai `scope`. */
export function overlayBranchProducts<T extends Product>(
  products: T[],
  rows: ProductBranchRow[],
  scope: BranchProductScope,
): T[] {
  const byProduct = new Map(rows.map((r) => [r.product_id, r]));
  const merged = products.map((p) => applyBranchRow(p, byProduct.get(p.id)));
  return merged.filter((p) =>
    scope === "available"
      ? p.branch_availability === "available"
      : p.branch_availability !== "unlisted",
  );
}

export function availabilityLabel(a: BranchAvailability): string {
  switch (a) {
    case "available":
      return "Tersedia";
    case "inactive":
      return "Nonaktif di outlet";
    default:
      return "Belum diaktifkan";
  }
}

export interface BranchSetupInput {
  stock: number;
  minStock: number;
  priceOverride: number | null;
  isService: boolean;
}

/** Validasi isian aktivasi produk di satu outlet. Mengembalikan pesan error pertama atau null. */
export function validateBranchSetup(input: BranchSetupInput): string | null {
  if (!Number.isInteger(input.stock) || input.stock < 0) {
    return "Stok awal harus bilangan bulat 0 atau lebih.";
  }
  if (input.isService && input.stock > 0) return "Produk jasa tidak punya stok.";
  if (!Number.isInteger(input.minStock) || input.minStock < 0) {
    return "Minimum stok harus bilangan bulat 0 atau lebih.";
  }
  if (
    input.priceOverride !== null &&
    (!Number.isInteger(input.priceOverride) || input.priceOverride <= 0)
  ) {
    return "Harga khusus outlet harus lebih dari 0.";
  }
  return null;
}

export interface TransferLineInput {
  productId: string;
  qty: number;
  available: number;
  name: string;
}

/** Validasi baris transfer stok. Mengembalikan pesan error pertama atau null. */
export function validateTransfer(
  fromBranchId: string | null,
  toBranchId: string | null,
  lines: TransferLineInput[],
): string | null {
  if (!fromBranchId) return "Pilih outlet asal.";
  if (!toBranchId) return "Pilih outlet tujuan.";
  if (fromBranchId === toBranchId) return "Outlet asal dan tujuan harus berbeda.";
  if (lines.length === 0) return "Tambahkan minimal satu produk.";
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) return `Produk "${line.name}" muncul lebih dari sekali.`;
    seen.add(line.productId);
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      return `Jumlah "${line.name}" harus bilangan bulat lebih dari 0.`;
    }
    if (line.qty > line.available) {
      return `Stok "${line.name}" tidak cukup (tersedia ${line.available}, transfer ${line.qty}).`;
    }
  }
  return null;
}
