// hooks/useProducts.ts
// ── TAMBAHAN ── Hook domain Produk: fetch data asli dari Supabase, menggantikan DUMMY_PRODUCTS di KasirModule.
// ── KOREKSI ── Tambah opsi includeInactive: layar Kasir hanya boleh menampilkan produk aktif,
// tapi layar admin Produk wajib bisa melihat & mengelola produk nonaktif juga (agar bisa diaktifkan kembali).
// Tanpa opsi ini, produk yang dinonaktifkan admin akan hilang total dari daftar admin — tidak bisa dikelola lagi.
// ── KOREKSI ── Ganti dari client lama (@/lib/supabase, localStorage-based) ke client
// cookie-based (@/lib/supabase/client) supaya sesi login ikut terbawa & auth.uid() valid.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Category, Product } from "@/lib/pos/types";
import { useBranchScope } from "@/hooks/useActiveBranch";
import {
  PRODUCT_BRANCH_COLUMNS,
  isMissingBranchInventoryError,
  normalizeProductBranchRow,
  overlayBranchProducts,
  type ProductBranchRow,
} from "@/lib/pos/productBranch";

const supabase = createClient();

// Produk hasil query, sudah di-join dengan kategorinya (untuk chip filter & label kategori)
export interface ProductWithCategory extends Product {
  category: Category | null;
}

interface UseProductsOptions {
  /**
   * false (default) → hanya produk aktif, dipakai layar Kasir.
   * true → semua produk (aktif & nonaktif), dipakai layar admin Produk.
   * Soft-deleted (deleted_at terisi) selalu dikecualikan di kedua mode.
   */
  includeInactive?: boolean;
  /**
   * Layar admin (Produk, Stok) memakai true: produk yang belum aktif di outlet
   * tetap muncul dengan `branch_availability`. Kasir memakai false (default).
   */
  includeUnlisted?: boolean;
}

interface UseProductsResult {
  products: ProductWithCategory[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const BRANCH_PAGE = 1000;

// PostgREST membatasi satu respons; daftar produk outlet diambil bertahap.
async function fetchBranchRows(
  branchId: string,
): Promise<{ rows: ProductBranchRow[]; error: { message?: string; code?: string } | null }> {
  const rows: ProductBranchRow[] = [];
  for (let from = 0; ; from += BRANCH_PAGE) {
    const { data, error } = await supabase
      .from("product_branches")
      .select(PRODUCT_BRANCH_COLUMNS)
      .eq("branch_id", branchId)
      .order("product_id", { ascending: true })
      .range(from, from + BRANCH_PAGE - 1);
    if (error) return { rows: [], error };
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page.map(normalizeProductBranchRow));
    if (page.length < BRANCH_PAGE) break;
  }
  return { rows, error: null };
}

export function useProducts(
  options: UseProductsOptions = {},
): UseProductsResult {
  const { includeInactive = false, includeUnlisted = includeInactive } = options;
  const { branchId, ready: branchReady } = useBranchScope();

  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    if (!branchReady) return;
    setIsLoading(true);
    setError(null);

    let query = supabase
      .from("products")
      .select("*, category:categories(*)")
      .is("deleted_at", null)
      .order("name", { ascending: true });

    // Kasir (PRD §4.2): katalog hanya boleh menampilkan produk aktif.
    // Admin Produk (PRD §4.3): wajib melihat semua, termasuk nonaktif, untuk dikelola.
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setProducts([]);
      setIsLoading(false);
      return;
    }

    const masters = (data ?? []) as ProductWithCategory[];

    // Tanpa outlet aktif (migration 047 belum jalan) produk tampil apa adanya.
    if (!branchId) {
      setProducts(masters);
      setIsLoading(false);
      return;
    }

    const branchRows = await fetchBranchRows(branchId);

    if (branchRows.error) {
      // Migration 052 belum dijalankan: perilaku lama (satu stok untuk semua outlet).
      if (isMissingBranchInventoryError(branchRows.error)) {
        setProducts(masters);
      } else {
        setError(branchRows.error.message ?? "Gagal memuat produk outlet.");
        setProducts([]);
      }
      setIsLoading(false);
      return;
    }

    const merged = overlayBranchProducts(masters, branchRows.rows, !includeUnlisted);
    setProducts(merged);
    setIsLoading(false);
  }, [includeInactive, includeUnlisted, branchId, branchReady]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // refetch dipakai manual setelah transaksi sukses, supaya angka stok di katalog langsung update
  return { products, isLoading, error, refetch: fetchProducts };
}