// lib/pos/types.ts
// ── TAMBAHAN ── Tipe domain Produk & Kategori, disamakan persis dengan skema SQL Supabase (PRD §6)

export type ProductType =
  | "FASHION"
  | "SABLON"
  | "KONVEKSI"
  | "PERCETAKAN"
  | "MERCHANDISE"
  | "PARFUM"
  // ── TAMBAHAN (migration 046) ── kantong plastik, paper bag, packaging (berstok).
  | "KEMASAN"
  | "JASA";

// Baris asli tabel `products` — nama kolom & tipe wajib sama persis dengan SQL
export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  type: ProductType;
  is_service: boolean;
  /** Migration 045: tampil di modal Biaya Tambahan Kasir walau bukan Jasa (stok tetap dihitung). */
  is_extra_charge?: boolean;
  /** Migration 055: harga diisi kasir saat transaksi (hanya JASA). sell_price jadi harga acuan. */
  is_custom_price?: boolean;
  /** Migration 055: harga satuan terendah untuk produk harga bebas, null = tanpa batas. */
  min_price?: number | null;
  category_id: string | null;
  unit: string | null;
  sell_price: number; // BIGINT rupiah, tanpa desimal
  cost_price: number | null;
  stock: number;
  min_stock: number;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Harga master sebelum harga khusus outlet. Diisi useProducts saat ada outlet aktif. */
  base_sell_price?: number;
  /** Status produk di outlet aktif. Diisi useProducts saat ada outlet aktif. */
  branch_availability?: BranchAvailability;
  /** Harga khusus outlet aktif, null kalau memakai harga master. */
  branch_price_override?: number | null;
}

export type BranchAvailability = "available" | "inactive" | "unlisted";

// Baris asli tabel `categories`
export interface Category {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

// Item di dalam keranjang Kasir — Product + qty, dipisah dari tipe Product murni
// supaya lib/pos/cartLogic.ts tidak bergantung pada state React apa pun.
export interface CartItem {
  /** Untuk baris harga bebas, sell_price sudah berisi harga yang diisi kasir. */
  product: Product;
  qty: number;
  /** Hanya baris harga bebas: kunci unik, karena produk yang sama boleh muncul berkali-kali. */
  lineId?: string;
  /** Hanya baris harga bebas: deskripsi pesanan. */
  note?: string;
}