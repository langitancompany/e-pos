import { createClient } from "../supabase/client";
import type { ProductType } from "./types";
import { assignProductBranch, updateProductBranch } from "./productBranchApi";
import { generateUniqueBarcode } from "./productCodesApi";

const supabase = createClient();

export type CreateProductInput = {
  name: string;
  sku: string;
  barcode: string;
  type: ProductType;
  category_id: string;
  unit: string;
  sell_price: number;
  cost_price: number;
  stock: number;
  min_stock: number;
  photo_url: string;
  is_active: boolean;
  /** Migration 045: tampilkan di Biaya Tambahan Kasir (stok tetap dihitung). */
  is_extra_charge?: boolean;
  /**
   * Outlet aktif (migration 052). Diisi: produk langsung diaktifkan di outlet ini
   * dengan stok awal dan minimum dari form, dan perubahan minimum stok berlaku
   * untuk outlet ini. Kosong: perilaku lama (stok disimpan di master produk).
   */
  branch_id?: string | null;
};

export type CreateProductResult =
  | {
      success: true;
      product: {
        id: string;
      };
      /** Produk tersimpan tetapi langkah outlet gagal. Tampilkan ke user. */
      warning?: string;
    }
  | {
      success: false;
      error: string;
    };

export async function createProduct(
  input: CreateProductInput,
): Promise<CreateProductResult> {
  const name = input.name.trim();
  const sku = input.sku.trim().toUpperCase();
  let barcode = input.barcode.trim();
  const unit = input.unit.trim();
  const photoUrl = input.photo_url.trim();

  if (!name) {
    return {
      success: false,
      error: "Nama produk wajib diisi.",
    };
  }

  if (!sku) {
    return {
      success: false,
      error: "SKU wajib diisi.",
    };
  }

  if (input.sell_price <= 0) {
    return {
      success: false,
      error: "Harga jual harus lebih dari 0.",
    };
  }

  if (input.cost_price < 0) {
    return {
      success: false,
      error: "Harga modal tidak boleh negatif.",
    };
  }

  if (input.stock < 0) {
    return {
      success: false,
      error: "Stok tidak boleh negatif.",
    };
  }

  if (input.min_stock < 0) {
    return {
      success: false,
      error: "Minimum stok tidak boleh negatif.",
    };
  }

  const isService = input.type === "JASA";

  // Barcode kosong diisi sistem supaya produk selalu punya kode untuk label.
  if (!barcode) {
    const generated = await generateUniqueBarcode();
    if (!generated.success) {
      return {
        success: false,
        error: `Barcode otomatis gagal dibuat: ${generated.error}`,
      };
    }
    barcode = generated.barcode;
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      sku,
      barcode: barcode || null,
      type: input.type,
      is_service: isService,
      category_id: input.category_id || null,
      unit: unit || null,
      sell_price: input.sell_price,
      cost_price: input.cost_price > 0 ? input.cost_price : null,
      // Dengan outlet, stok awal dicatat lewat assign_product_branch supaya masuk
      // ke stok outlet dan kartu stok, bukan ke master.
      stock: isService || input.branch_id ? 0 : input.stock,
      min_stock: isService ? 0 : input.min_stock,
      photo_url: photoUrl || null,
      is_active: input.is_active,
      is_extra_charge: input.is_extra_charge ?? false,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "SKU tersebut sudah digunakan. Gunakan SKU yang berbeda.",
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }

  if (input.branch_id) {
    const initialStock = isService ? 0 : input.stock;
    const minStock = isService ? 0 : input.min_stock;
    const assigned = await assignProductBranch({
      productId: data.id,
      branchId: input.branch_id,
      stock: initialStock,
      minStock,
    });

    if (!assigned.success) {
      // Stok awal butuh izin ubah stok. Tanpa izin itu, pasang produk dengan stok 0
      // supaya produknya tetap muncul di outlet, lalu beri tahu stok awalnya belum masuk.
      const withoutStock =
        initialStock > 0
          ? await assignProductBranch({
              productId: data.id,
              branchId: input.branch_id,
              stock: 0,
              minStock,
            })
          : null;

      return {
        success: true,
        product: { id: data.id },
        warning: withoutStock?.success
          ? `Produk tersimpan dan aktif di outlet ini, tetapi stok awal tidak tercatat: ${assigned.error} Isi stok lewat Barang Masuk.`
          : `Produk tersimpan, tetapi belum aktif di outlet ini: ${assigned.error} Aktifkan lewat tombol di baris produknya.`,
      };
    }
  }

  return {
    success: true,
    product: {
      id: data.id,
    },
  };
}

// ── PERBAIKAN (Stok & Opname) ── Edit Produk TIDAK lagi mengubah stok.
// Sebelumnya `stock` ikut di-UPDATE langsung ke tabel products tanpa mutasi,
// sehingga perubahan stok tidak punya jejak di riwayat/kartu stok dan saldo
// sebelum/sesudah di kartu stok jadi bergeser. Stok sekarang HANYA berubah lewat
// RPC (penjualan/retur/void/opname/penyesuaian), jadi tipe input update
// sengaja tidak punya field `stock`.
export type UpdateProductInput = Omit<CreateProductInput, "stock"> & {
  id: string;
};

export type UpdateProductResult =
  | {
      success: true;
      product: {
        id: string;
      };
    }
  | {
      success: false;
      error: string;
    };

export async function updateProduct(
  input: UpdateProductInput,
): Promise<UpdateProductResult> {
  const name = input.name.trim();
  const sku = input.sku.trim().toUpperCase();
  const barcode = input.barcode.trim();
  const unit = input.unit.trim();
  const photoUrl = input.photo_url.trim();

  if (!name) {
    return {
      success: false,
      error: "Nama produk wajib diisi.",
    };
  }

  if (!sku) {
    return {
      success: false,
      error: "SKU wajib diisi.",
    };
  }

  if (input.sell_price <= 0) {
    return {
      success: false,
      error: "Harga jual harus lebih dari 0.",
    };
  }

  if (input.cost_price < 0) {
    return {
      success: false,
      error: "Harga modal tidak boleh negatif.",
    };
  }

  if (input.min_stock < 0) {
    return {
      success: false,
      error: "Minimum stok tidak boleh negatif.",
    };
  }

  const isService = input.type === "JASA";

  // Produk jasa tidak punya stok. Kalau produk fisik yang masih punya stok
  // diubah jadi jasa, stoknya akan "hilang" tanpa mutasi — tolak, minta
  // dikosongkan dulu lewat Opname supaya ada jejaknya.
  if (isService) {
    const { data: current, error: currentError } = await supabase
      .from("products")
      .select("stock")
      .eq("id", input.id)
      .single();

    if (currentError) {
      return {
        success: false,
        error: currentError.message,
      };
    }

    if ((current?.stock ?? 0) > 0) {
      return {
        success: false,
        error: `Produk ini masih punya stok ${current.stock}. Kosongkan stoknya lewat Opname di menu Stok & Opname dulu sebelum mengubah tipe menjadi Jasa.`,
      };
    }
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      name,
      sku,
      barcode: barcode || null,
      type: input.type,
      is_service: isService,
      category_id: input.category_id || null,
      unit: unit || null,
      sell_price: input.sell_price,
      cost_price: input.cost_price > 0 ? input.cost_price : null,
      // `stock` SENGAJA tidak ikut di-update (lihat catatan UpdateProductInput).
      min_stock: isService ? 0 : input.min_stock,
      photo_url: photoUrl || null,
      is_active: input.is_active,
      is_extra_charge: input.is_extra_charge ?? false,
    })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "SKU tersebut sudah digunakan. Gunakan SKU yang berbeda.",
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }

  if (input.branch_id && !isService) {
    const saved = await updateProductBranch({
      productId: data.id,
      branchId: input.branch_id,
      minStock: input.min_stock,
    });
    // Produk belum diaktifkan di outlet ini bukan kegagalan simpan master.
    if (!saved.success && !/belum diaktifkan/i.test(saved.error)) {
      return { success: false, error: saved.error };
    }
  }

  return {
    success: true,
    product: {
      id: data.id,
    },
  };
}
// ── TAMBAHAN (T-09) ── Soft-delete & restore produk, lewat RPC
// `soft_delete_product` / `restore_product` (migration 014). SENGAJA tidak
// pakai `supabase.from("products").update({ deleted_at: ... })` langsung —
// permission admin-only (PRD §5, baris `produk` delete cuma ✔ di kolom
// Admin) ditegakkan DI DALAM RPC, bukan cuma di UI. Kalau ditulis langsung
// dari client, non-admin yang tahu bentuk request-nya bisa lolos, karena
// tabel `products` tidak punya RLS write policy sama sekali untuk mencegah
// itu (pola yang sama seperti `stock_movements`/`transactions` — semua
// tulisan wajib lewat RPC security definer).

export type DeleteProductResult =
  | { success: true }
  | { success: false; error: string };

/** Pindahkan produk ke Sampah (isi `deleted_at`). Alasan opsional. */
export async function deleteProduct(
  productId: string,
  reason?: string,
): Promise<DeleteProductResult> {
  const { data, error } = await supabase.rpc("soft_delete_product", {
    p_product_id: productId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    console.error("soft_delete_product RPC error:", error);
    return {
      success: false,
      error: error.message || "Gagal menghapus produk.",
    };
  }

  if (!data?.success) {
    return { success: false, error: "Produk gagal dihapus." };
  }

  return { success: true };
}

/** Hapus PERMANEN produk yang sudah ada di Sampah. Tidak bisa dibatalkan. */
export async function permanentDeleteProduct(
  productId: string,
): Promise<DeleteProductResult> {
  const { data, error } = await supabase.rpc("permanent_delete_product", {
    p_product_id: productId,
  });

  if (error) {
    console.error("permanent_delete_product RPC error:", error);
    return {
      success: false,
      error: error.message || "Gagal menghapus permanen produk.",
    };
  }

  if (!data?.success) {
    return { success: false, error: "Produk gagal dihapus permanen." };
  }

  return { success: true };
}

/** Pulihkan produk dari Sampah (kosongkan `deleted_at`). */
export async function restoreProduct(
  productId: string,
): Promise<DeleteProductResult> {
  const { data, error } = await supabase.rpc("restore_product", {
    p_product_id: productId,
  });

  if (error) {
    console.error("restore_product RPC error:", error);
    return {
      success: false,
      error: error.message || "Gagal memulihkan produk.",
    };
  }

  if (!data?.success) {
    return { success: false, error: "Produk gagal dipulihkan." };
  }

  return { success: true };
}