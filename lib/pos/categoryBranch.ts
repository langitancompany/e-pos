// Kategori per outlet (migration 054). Fungsi murni, tanpa akses jaringan.

import type { Category } from "./types";

export interface CategoryBranchRow {
  category_id: string;
  branch_id: string;
}

export const CATEGORY_BRANCH_COLUMNS = "category_id, branch_id";

/** Error karena tabel/RPC migration 054 belum ada. */
export function isMissingCategoryBranchError(
  err: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202") return true;
  return /category_branches|create_category|set_category_branch/.test(err.message ?? "");
}

/** Kategori yang terpasang di outlet: hanya yang punya baris untuk outlet itu. */
export function filterCategoriesForBranch<T extends Pick<Category, "id">>(
  categories: T[],
  listedCategoryIds: ReadonlySet<string>,
): T[] {
  return categories.filter((c) => listedCategoryIds.has(c.id));
}
