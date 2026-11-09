import { createProduct, type CreateProductInput } from "./productLogic";
import type { ImportRow, ParsedProduct } from "./productImport";

const DEFAULT_CONCURRENCY = 4;

export interface ImportOutcome {
  rowNumber: number;
  label: string;
  success: boolean;
  error?: string;
  /** Produk tersimpan, tetapi satu langkah tambahan (mis. stok awal outlet) gagal. */
  warning?: string;
}

export interface ImportOptions {
  /** Outlet aktif: produk langsung dipasang di sini dengan stok dan minimum dari file. */
  branchId: string | null;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export function toCreateInput(
  product: ParsedProduct,
  branchId: string | null,
): CreateProductInput {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    type: product.type,
    category_id: product.categoryId ?? "",
    unit: product.unit,
    sell_price: product.sellPrice,
    cost_price: product.costPrice,
    stock: product.stock,
    min_stock: product.minStock,
    photo_url: "",
    is_active: product.isActive,
    // Sama seperti form manual: KEMASAN selalu tampil di Biaya Tambahan Kasir.
    is_extra_charge: product.type === "KEMASAN",
    branch_id: branchId,
  };
}

/**
 * Menyimpan semua baris valid. Baris bermasalah dilewati dan tidak masuk hasil.
 * Satu baris gagal tidak menghentikan baris lain.
 */
export async function importProducts(
  rows: ImportRow[],
  options: ImportOptions,
): Promise<ImportOutcome[]> {
  const queue = rows.filter(
    (row): row is ImportRow & { product: ParsedProduct } => row.product !== null,
  );
  const outcomes: ImportOutcome[] = new Array(queue.length);
  const workers = Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, queue.length);
  let next = 0;
  let done = 0;

  async function work() {
    while (next < queue.length) {
      const index = next;
      next += 1;
      const row = queue[index];
      const base = { rowNumber: row.rowNumber, label: row.label };

      try {
        const result = await createProduct(toCreateInput(row.product, options.branchId));
        outcomes[index] = result.success
          ? { ...base, success: true, warning: result.warning }
          : { ...base, success: false, error: result.error };
      } catch (err) {
        outcomes[index] = {
          ...base,
          success: false,
          error: err instanceof Error ? err.message : "Gagal menyimpan produk.",
        };
      }

      done += 1;
      options.onProgress?.(done, queue.length);
    }
  }

  await Promise.all(Array.from({ length: workers }, work));
  return outcomes;
}
