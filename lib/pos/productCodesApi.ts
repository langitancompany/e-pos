import { createClient } from "../supabase/client";
import { generateBarcode } from "./productBarcode";

const supabase = createClient();

const PAGE_SIZE = 1000;
const UNIQUE_ATTEMPTS = 5;

export type ProductCodesResult =
  | { success: true; skus: Set<string>; barcodes: Set<string> }
  | { success: false; error: string };

// Semua produk dibaca, termasuk yang ada di Sampah: SKU tetap unik di seluruh
// tabel dan produk Sampah bisa dipulihkan kapan saja.
export async function fetchProductCodes(): Promise<ProductCodesResult> {
  const skus = new Set<string>();
  const barcodes = new Set<string>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("products")
      .select("sku, barcode")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { success: false, error: error.message };

    const page = (data ?? []) as { sku: string | null; barcode: string | null }[];
    for (const row of page) {
      if (row.sku) skus.add(row.sku.trim().toUpperCase());
      if (row.barcode) barcodes.add(row.barcode.trim());
    }
    if (page.length < PAGE_SIZE) break;
  }

  return { success: true, skus, barcodes };
}

export type UniqueBarcodeResult =
  | { success: true; barcode: string }
  | { success: false; error: string };

// Kolom barcode tidak punya constraint unik, jadi keunikan dicek lewat query.
export async function generateUniqueBarcode(): Promise<UniqueBarcodeResult> {
  for (let attempt = 0; attempt < UNIQUE_ATTEMPTS; attempt += 1) {
    const candidate = generateBarcode();

    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("barcode", candidate);

    if (error) return { success: false, error: error.message };
    if (count === 0) return { success: true, barcode: candidate };
  }

  return { success: false, error: "Gagal membuat barcode unik. Coba simpan lagi." };
}
