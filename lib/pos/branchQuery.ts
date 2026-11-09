// Pembacaan daftar outlet yang dipakai bersama oleh useActiveBranch dan useBranches.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BRANCH_BASE_COLUMNS,
  BRANCH_COLUMNS,
  BRANCH_COLUMNS_NO_TYPE,
  isMissingBranchColumnError,
  isMissingBranchTypeError,
} from "./branches";

export interface BranchRowsResult {
  rows: Record<string, unknown>[];
  errorMessage: string | null;
}

/**
 * Baca outlet dengan kolom selengkap yang dikenal database. Migration 053 (jenis
 * outlet) atau 048 (pengaturan outlet) yang belum dijalankan membuat query
 * jatuh ke kolom yang lebih sedikit, supaya daftar outlet tetap termuat.
 */
export async function selectBranchRows(client: SupabaseClient): Promise<BranchRowsResult> {
  let lastMessage: string | null = null;

  for (const columns of [BRANCH_COLUMNS, BRANCH_COLUMNS_NO_TYPE, BRANCH_BASE_COLUMNS]) {
    const { data, error } = await client
      .from("branches")
      .select(columns)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (!error) {
      return { rows: (data ?? []) as unknown as Record<string, unknown>[], errorMessage: null };
    }

    lastMessage = error.message;
    const missingColumn =
      isMissingBranchTypeError(error.message) || isMissingBranchColumnError(error.message);
    if (!missingColumn) break;
  }

  return { rows: [], errorMessage: lastMessage };
}
