// Pemanggil RPC ketersediaan produk dan transfer stok per outlet (migration 052).

import { createClient } from "../supabase/client";
import {
  PRODUCT_BRANCH_COLUMNS,
  isMissingBranchInventoryError,
  normalizeProductBranchRow,
  type ProductBranchRow,
} from "./productBranch";

const supabase = createClient();

export const BRANCH_MIGRATION_HINT =
  "Database belum diperbarui. Jalankan migration 052_branch_inventory.sql di Supabase terlebih dulu.";

export type ApiResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

function failure(err: { message?: string; code?: string }, fallback: string): { success: false; error: string } {
  if (isMissingBranchInventoryError(err)) return { success: false, error: BRANCH_MIGRATION_HINT };
  return { success: false, error: err.message || fallback };
}

export interface AssignInput {
  productId: string;
  branchId: string;
  stock?: number;
  minStock?: number | null;
  priceOverride?: number | null;
}

export async function assignProductBranch(input: AssignInput): Promise<ApiResult> {
  const { error } = await supabase.rpc("assign_product_branch", {
    p_product_id: input.productId,
    p_branch_id: input.branchId,
    p_stock: input.stock ?? 0,
    p_min_stock: input.minStock ?? null,
    p_price_override: input.priceOverride ?? null,
    p_reason: null,
  });
  if (error) return failure(error, "Gagal mengaktifkan produk di outlet.");
  return { success: true };
}

export async function bulkAssignProductBranch(
  branchId: string,
  productIds: string[],
): Promise<ApiResult<{ assigned: number; reactivated: number }>> {
  const { data, error } = await supabase.rpc("bulk_assign_product_branch", {
    p_branch_id: branchId,
    p_product_ids: productIds,
  });
  if (error) return failure(error, "Gagal mengaktifkan produk di outlet.");
  return {
    success: true,
    assigned: Number(data?.assigned ?? 0),
    reactivated: Number(data?.reactivated ?? 0),
  };
}

export interface UpdateListingInput {
  productId: string;
  branchId: string;
  isActive?: boolean;
  minStock?: number;
  priceOverride?: number | null;
  clearPriceOverride?: boolean;
}

export async function updateProductBranch(input: UpdateListingInput): Promise<ApiResult> {
  const { error } = await supabase.rpc("update_product_branch", {
    p_product_id: input.productId,
    p_branch_id: input.branchId,
    p_is_active: input.isActive ?? null,
    p_min_stock: input.minStock ?? null,
    p_price_override: input.priceOverride ?? null,
    p_clear_price_override: input.clearPriceOverride ?? false,
  });
  if (error) return failure(error, "Gagal menyimpan pengaturan outlet.");
  return { success: true };
}

/** Baris ketersediaan satu produk di semua outlet yang boleh diakses user. */
export async function fetchProductBranchRows(
  productId: string,
): Promise<{ rows: ProductBranchRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("product_branches")
    .select(PRODUCT_BRANCH_COLUMNS)
    .eq("product_id", productId);
  if (error) {
    if (isMissingBranchInventoryError(error)) return { rows: [], error: BRANCH_MIGRATION_HINT };
    return { rows: [], error: error.message };
  }
  return {
    rows: ((data ?? []) as Record<string, unknown>[]).map(normalizeProductBranchRow),
    error: null,
  };
}

export interface TransferItemInput {
  productId: string;
  qty: number;
}

export async function transferStock(input: {
  fromBranchId: string;
  toBranchId: string;
  items: TransferItemInput[];
  note: string;
}): Promise<ApiResult<{ transferId: string; number: number }>> {
  const { data, error } = await supabase.rpc("transfer_stock", {
    p_from_branch_id: input.fromBranchId,
    p_to_branch_id: input.toBranchId,
    p_items: input.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_note: input.note.trim() || null,
  });
  if (error) return failure(error, "Gagal memindahkan stok.");
  if (!data?.success) return { success: false, error: "Transfer stok gagal disimpan." };
  return { success: true, transferId: String(data.transfer_id), number: Number(data.number) };
}
