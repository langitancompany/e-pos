// hooks/useCategories.ts
// ── TAMBAHAN ── Hook domain Kategori: fetch data asli dari Supabase untuk chip filter di Kasir & CRUD di Produk.
// ── KOREKSI ── Ganti dari client lama (@/lib/supabase, localStorage-based) ke client
// cookie-based (@/lib/supabase/client) supaya sesi login ikut terbawa & auth.uid() valid.
// ── TAMBAHAN ── Opsi includeInactive + fungsi tulis (create/update/remove/setActive),
// supaya KategoriModule tidak lagi memanggil supabase.from("categories") langsung
// (pola yang sama dengan useProducts). Default hook tidak berubah: hanya kategori aktif.
// ── TAMBAHAN (migration 054) ── Kategori per outlet: hanya kategori yang terpasang di
// outlet aktif yang ikut, dan kategori baru langsung dipasang di outlet aktif.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Category } from "@/lib/pos/types";
import { useBranchScope } from "@/hooks/useActiveBranch";
import { filterCategoriesForBranch } from "@/lib/pos/categoryBranch";
import {
  CATEGORY_MIGRATION_HINT,
  createCategoryAtBranch,
  fetchBranchCategoryRows,
} from "@/lib/pos/categoryBranchApi";
import {
  CATEGORY_DELETE_ERROR_MESSAGE,
  categorySaveErrorMessage,
  type CategoryInput,
} from "@/lib/pos/categoryLogic";

const supabase = createClient();

interface UseCategoriesOptions {
  /**
   * false (default) → hanya kategori aktif, dipakai chip filter Kasir & form Produk.
   * true → semua kategori (aktif & nonaktif), dipakai layar admin Kategori agar
   * kategori nonaktif tetap bisa diaktifkan kembali.
   */
  includeInactive?: boolean;
}

/** Hasil operasi tulis: error berisi pesan siap tampil, null jika sukses. */
export interface CategoryWriteResult {
  error: string | null;
}

interface UseCategoriesResult {
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createCategory: (input: CategoryInput) => Promise<CategoryWriteResult>;
  updateCategory: (
    id: string,
    input: CategoryInput,
  ) => Promise<CategoryWriteResult>;
  deleteCategory: (id: string) => Promise<CategoryWriteResult>;
  setCategoryActive: (
    id: string,
    isActive: boolean,
  ) => Promise<CategoryWriteResult>;
}

export function useCategories(
  options: UseCategoriesOptions = {},
): UseCategoriesResult {
  const { includeInactive = false } = options;
  const { branchId, ready: branchReady } = useBranchScope();

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    if (!branchReady) return;
    setIsLoading(true);
    setError(null);

    // Diurutkan sesuai sort_order (posisi chip mengikuti pengaturan admin).
    // Mode admin menambah urutan kedua berdasarkan nama agar daftar stabil.
    let query = supabase
      .from("categories")
      .select("id, name, sort_order, is_active")
      .order("sort_order", { ascending: true });

    if (includeInactive) {
      query = query.order("name", { ascending: true });
    } else {
      query = query.eq("is_active", true);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setCategories([]);
      setIsLoading(false);
      return;
    }

    const all = (data ?? []) as Category[];

    // Tanpa outlet aktif, atau migration 054 belum dijalankan: semua kategori tampil (perilaku lama).
    if (!branchId) {
      setCategories(all);
      setIsLoading(false);
      return;
    }

    const listed = await fetchBranchCategoryRows(branchId);

    if (listed.error) {
      setError(listed.error);
      setCategories([]);
    } else if (listed.missing) {
      setCategories(all);
    } else {
      setCategories(
        filterCategoriesForBranch(all, new Set(listed.rows.map((r) => r.category_id))),
      );
    }

    setIsLoading(false);
  }, [includeInactive, branchId, branchReady]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Setiap tulis yang sukses memuat ulang daftar supaya UI selalu sinkron dengan DB.
  const createCategory = useCallback(
    async (input: CategoryInput): Promise<CategoryWriteResult> => {
      // Dengan outlet aktif, kategori dibuat dan dipasang di outlet itu dalam satu langkah.
      if (branchId) {
        const created = await createCategoryAtBranch({
          name: input.name,
          sortOrder: input.sort_order,
          isActive: input.is_active,
          branchId,
        });
        if (created.success) {
          await fetchCategories();
          return { error: null };
        }
        // Migration 054 belum jalan: pakai jalur lama di bawah.
        if (created.error !== CATEGORY_MIGRATION_HINT) return { error: created.error };
      }

      const { error: writeError } = await supabase
        .from("categories")
        .insert(input);
      if (writeError) return { error: categorySaveErrorMessage(writeError) };
      await fetchCategories();
      return { error: null };
    },
    [fetchCategories, branchId],
  );

  const updateCategory = useCallback(
    async (id: string, input: CategoryInput): Promise<CategoryWriteResult> => {
      const { error: writeError } = await supabase
        .from("categories")
        .update(input)
        .eq("id", id);
      if (writeError) return { error: categorySaveErrorMessage(writeError) };
      await fetchCategories();
      return { error: null };
    },
    [fetchCategories],
  );

  const deleteCategory = useCallback(
    async (id: string): Promise<CategoryWriteResult> => {
      const { error: deleteError } = await supabase
        .from("categories")
        .delete()
        .eq("id", id);
      if (deleteError) return { error: CATEGORY_DELETE_ERROR_MESSAGE };
      await fetchCategories();
      return { error: null };
    },
    [fetchCategories],
  );

  const setCategoryActive = useCallback(
    async (id: string, isActive: boolean): Promise<CategoryWriteResult> => {
      const { error: writeError } = await supabase
        .from("categories")
        .update({ is_active: isActive })
        .eq("id", id);
      if (writeError) return { error: writeError.message };
      await fetchCategories();
      return { error: null };
    },
    [fetchCategories],
  );

  return {
    categories,
    isLoading,
    error,
    refetch: fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    setCategoryActive,
  };
}
