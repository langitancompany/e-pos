// Pemanggil RPC dan query kategori per outlet (migration 054).

import { createClient } from "../supabase/client";
import {
  CATEGORY_BRANCH_COLUMNS,
  isMissingCategoryBranchError,
  type CategoryBranchRow,
} from "./categoryBranch";

const supabase = createClient();

export const CATEGORY_MIGRATION_HINT =
  "Database belum diperbarui. Jalankan migration 054_category_branches.sql di Supabase terlebih dulu.";

export type CategoryApiResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

function failure(err: { message?: string; code?: string }, fallback: string) {
  if (isMissingCategoryBranchError(err)) return { success: false as const, error: CATEGORY_MIGRATION_HINT };
  return { success: false as const, error: err.message || fallback };
}

/** Buat kategori dan pasang hanya di outlet `branchId`. */
export async function createCategoryAtBranch(input: {
  name: string;
  sortOrder: number;
  isActive: boolean;
  branchId: string;
}): Promise<CategoryApiResult<{ id: string }>> {
  const { data, error } = await supabase.rpc("create_category", {
    p_name: input.name,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
    p_branch_id: input.branchId,
  });
  if (error) return failure(error, "Gagal menambah kategori.");
  return { success: true, id: String(data) };
}

/** Pasang (listed true) atau lepas (false) kategori di satu outlet. */
export async function setCategoryBranch(input: {
  categoryId: string;
  branchId: string;
  listed: boolean;
}): Promise<CategoryApiResult> {
  const { error } = await supabase.rpc("set_category_branch", {
    p_category_id: input.categoryId,
    p_branch_id: input.branchId,
    p_listed: input.listed,
  });
  if (error) return failure(error, "Gagal mengatur kategori di outlet.");
  return { success: true };
}

/** Baris pemasangan satu outlet. `missing` true = migration 054 belum dijalankan. */
export async function fetchBranchCategoryRows(
  branchId: string,
): Promise<{ rows: CategoryBranchRow[]; missing: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("category_branches")
    .select(CATEGORY_BRANCH_COLUMNS)
    .eq("branch_id", branchId);
  if (error) {
    if (isMissingCategoryBranchError(error)) return { rows: [], missing: true, error: null };
    return { rows: [], missing: false, error: error.message };
  }
  return { rows: (data ?? []) as CategoryBranchRow[], missing: false, error: null };
}

/** Pemasangan satu kategori di semua outlet yang boleh diakses user. */
export async function fetchCategoryBranchRows(
  categoryId: string,
): Promise<{ rows: CategoryBranchRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("category_branches")
    .select(CATEGORY_BRANCH_COLUMNS)
    .eq("category_id", categoryId);
  if (error) {
    return { rows: [], error: isMissingCategoryBranchError(error) ? CATEGORY_MIGRATION_HINT : error.message };
  }
  return { rows: (data ?? []) as CategoryBranchRow[], error: null };
}
