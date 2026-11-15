"use client";

// app/components/kasir/KasirProductPanel.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Panel Produk (mode Tablet): pemilih pelanggan (slot), kolom cari + tombol
// scan/Biaya Tambahan, chip kategori, grid produk, dan tombol mengambang
// "Lihat Keranjang" di HP.
//
// Responsif: `min-h-0` (bukan `h-full`) agar panel mengambil SISA tinggi dari
// flex parent. Di bawah `md` hanya SATU panel yang tampil sekaligus (tab
// "Produk" vs "Keranjang" lewat `mobileView`); dari `md` ke atas kedua panel
// selalu berdampingan.

import type { ReactNode } from "react";
import {
  Camera,
  PackagePlus,
  Search,
  ShoppingCart,
} from "lucide-react";
import type { Category, CartItem } from "@/lib/pos/types";
import type { ProductWithCategory } from "@/hooks/useProducts";
import { formatRupiah, getCartItemCount } from "@/lib/pos/cartLogic";
import IconButton from "@/app/components/ui/IconButton";
import KasirProductGrid from "./KasirProductGrid";

interface KasirProductPanelProps {
  mobileView: "products" | "cart";
  /** Slot <KasirCustomerPicker /> (di atas kolom cari). */
  customerPicker: ReactNode;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onOpenScan: () => void;
  onOpenBiayaTambahan: () => void;
  categories: Category[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  /** Produk yang SUDAH difilter (kategori + pencarian). */
  products: ProductWithCategory[];
  cart: CartItem[];
  onAddToCart: (product: ProductWithCategory) => void;
  onShowCart: () => void;
  grandTotal: number;
}

export default function KasirProductPanel({
  mobileView,
  customerPicker,
  searchQuery,
  onSearchQueryChange,
  onOpenScan,
  onOpenBiayaTambahan,
  categories,
  selectedCategoryId,
  onSelectCategory,
  products,
  cart,
  onAddToCart,
  onShowCart,
  grandTotal,
}: KasirProductPanelProps) {
  return (
    <div
      className={`${mobileView === "products" ? "flex" : "hidden"} md:flex flex-1 flex-col min-h-0 border-r border-zinc-200 dark:border-zinc-800`}
    >
      <div className="p-4 sm:p-5 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-4 z-10">
        {customerPicker}

        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
            <input
              type="text"
              placeholder="Cari nama, SKU, atau scan barcode..."
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
            />
          </div>
          {/* ── TAMBAHAN (T-11 bagian 3) ── Scan pakai kamera, pelengkap alat
          scanner fisik (yang sudah bisa lewat kolom pencarian di atas —
          scanner fisik mengetik seperti keyboard). */}
          <IconButton
            variant="outlined"
            aria-label="Scan barcode (kamera)"
            title="Scan Barcode (Kamera)"
            className="h-10 w-10"
            onClick={onOpenScan}
          >
            <Camera className="h-4 w-4" />
          </IconButton>
          {/* ── TAMBAHAN (Fase 2: Biaya Tambahan) ── */}
          <IconButton
            variant="outlined"
            aria-label="Biaya tambahan"
            title="Biaya Tambahan"
            className="h-10 w-10"
            onClick={onOpenBiayaTambahan}
          >
            <PackagePlus className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => onSelectCategory(null)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition-colors duration-150 ${
              selectedCategoryId === null
                ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            Semua
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition-colors duration-150 ${
                selectedCategoryId === cat.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      <KasirProductGrid
        products={products}
        cart={cart}
        onAddToCart={onAddToCart}
      />

      {/* ── TAMBAHAN (responsif HP) ── Hanya tampil di bawah breakpoint
      `md` (di `md` ke atas keranjang sudah kelihatan di sebelah, jadi
      tombol ini tidak perlu). Ini pengganti scroll panjang ke bawah —
      kasir cukup tap untuk pindah ke layar Keranjang. */}
      {cart.length > 0 && (
        <button
          type="button"
          onClick={onShowCart}
          className="md:hidden shrink-0 flex items-center justify-between gap-3 mx-4 mb-4 px-4 py-3 rounded-xl bg-lco-teal hover:opacity-90 text-white shadow-lg transition-opacity duration-150"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="w-4 h-4" />
            {getCartItemCount(cart)} item
          </span>
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="font-mono tabular-nums">
              {formatRupiah(grandTotal)}
            </span>
            <span className="text-xs font-medium underline underline-offset-2">
              Lihat Keranjang
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
