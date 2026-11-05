// lib/pos/categoryLogic.ts
// Logika murni untuk form Kategori (tanpa React & tanpa Supabase) supaya bisa dites di
// environment node. Dipakai oleh hooks/useCategories.ts dan KategoriModule.tsx.

export interface CategoryInput {
  name: string;
  sort_order: number;
  is_active: boolean;
}

export type CategoryInputResult =
  | { ok: true; value: CategoryInput }
  | { ok: false; message: string };

/**
 * Validasi isian form kategori. `sortOrder` datang sebagai string karena berasal dari <input>.
 * Nama di-trim; urutan harus angka berhingga >= 0.
 */
export function validateCategoryInput(raw: {
  name: string;
  sort_order: string;
  is_active: boolean;
}): CategoryInputResult {
  const name = raw.name.trim();
  if (!name) {
    return { ok: false, message: "Nama kategori wajib diisi." };
  }

  const sortOrder = Number(raw.sort_order);
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    return { ok: false, message: "Urutan harus berupa angka 0 atau lebih." };
  }

  return {
    ok: true,
    value: { name, sort_order: sortOrder, is_active: raw.is_active },
  };
}

/** Pesan error simpan (insert/update) yang ramah pengguna. 23505 = unique violation Postgres. */
export function categorySaveErrorMessage(error: {
  code?: string;
  message: string;
}): string {
  if (error.code === "23505") {
    return "Kategori dengan nama tersebut sudah ada.";
  }
  return error.message;
}

/** Pesan error hapus. Penyebab paling umum: kategori masih dipakai produk (FK). */
export const CATEGORY_DELETE_ERROR_MESSAGE =
  "Kategori tidak dapat dihapus. Jika sudah digunakan produk, nonaktifkan kategori tersebut.";
