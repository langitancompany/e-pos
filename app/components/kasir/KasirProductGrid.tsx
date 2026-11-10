"use client";

// app/components/kasir/KasirProductGrid.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Grid katalog produk (mode Tablet). Kolom disesuaikan per lebar layar: 2 kolom
// di HP kecil, 3 di HP besar/tablet potret, turun ke 2 persis di breakpoint
// `md` (saat panel Keranjang mulai tampil di sebelah), lalu naik lagi ke 3-4
// kolom seiring layar makin lebar.

import type { CartItem } from "@/lib/pos/types";
import type { ProductWithCategory } from "@/hooks/useProducts";
import {
  formatRupiah,
  getAvailableStock,
  isOutOfStock,
} from "@/lib/pos/cartLogic";

interface KasirProductGridProps {
  /** Produk yang SUDAH difilter (kategori + pencarian). */
  products: ProductWithCategory[];
  cart: CartItem[];
  onAddToCart: (product: ProductWithCategory) => void;
}

export default function KasirProductGrid({
  products,
  cart,
  onAddToCart,
}: KasirProductGridProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
      {products.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 text-xs">
          Tidak ada produk yang cocok.
        </div>
      ) : (
        // ── PERBAIKAN (responsif HP/tablet) ── Kolom disesuaikan per lebar
        // layar: 2 kolom di HP kecil, 3 di HP besar/tablet potret, turun
        // ke 2 lagi persis di breakpoint `md` (saat panel Keranjang mulai
        // tampil di sebelah, jatah lebar panel ini otomatis menyempit),
        // lalu naik lagi ke 3-4 kolom seiring layar makin lebar.
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          {products.map((product) => {
            const inCartQty = cart
              .filter((item) => item.product.id === product.id)
              .reduce((sum, item) => sum + item.qty, 0);
            const outOfStock = isOutOfStock(product);
            const isMaxReached =
              inCartQty >= getAvailableStock(product);

            return (
              <button
                key={product.id}
                onClick={() => onAddToCart(product)}
                disabled={outOfStock || isMaxReached}
                className={`flex flex-col text-left bg-white dark:bg-zinc-950 p-4 rounded-xl border transition-colors duration-150 relative overflow-hidden group ${
                  outOfStock
                    ? "border-zinc-200 dark:border-zinc-800 opacity-50 cursor-not-allowed grayscale"
                    : isMaxReached
                      ? "border-lco-coral/50 cursor-not-allowed"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-lco-teal"
                }`}
              >
                {inCartQty > 0 && (
                  <div className="absolute top-2 right-2 bg-lco-teal text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10 tabular-nums">
                    {inCartQty} di keranjang
                  </div>
                )}
                <div className="w-full aspect-square bg-zinc-50 dark:bg-zinc-900 rounded-md mb-3 flex items-center justify-center border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  {product.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.photo_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {product.sku}
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-semibold tracking-tight leading-tight mb-1">
                  {product.name}
                </h3>
                <div className="mt-auto pt-2 flex items-end justify-between w-full">
                  <span className="font-mono font-semibold text-lco-teal text-sm tabular-nums">
                    {product.is_custom_price
                      ? "Harga bebas"
                      : formatRupiah(product.sell_price)}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-[0.12em] font-semibold font-mono tabular-nums ${outOfStock ? "text-lco-coral" : "text-zinc-500"}`}
                  >
                    {product.is_service
                      ? "Jasa"
                      : `Stok: ${product.stock}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
