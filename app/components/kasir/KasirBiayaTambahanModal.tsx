"use client";

// app/components/kasir/KasirBiayaTambahanModal.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Biaya Tambahan (Fase 2): item non-produk (kantong kresek, ongkos kirim, dst.)
// ditambahkan lewat produk BERTIPE JASA (`is_service`) yang sudah didukung
// penuh oleh RPC create_transaction (stok tak terbatas). Tidak perlu
// tabel/migration baru — admin menandai produk seperti "Kantong Kresek" sebagai
// Jasa di menu Produk. Daftar item disaring oleh filterServiceProducts
// (lib/pos/kasirLogic.ts). Klik satu item menambahkannya ke keranjang (qty 1,
// bisa diubah di panel keranjang); modal ditutup lewat tombol "Simpan".

import { PackagePlus, X } from "lucide-react";
import type { CartItem } from "@/lib/pos/types";
import type { ProductWithCategory } from "@/hooks/useProducts";
import { formatRupiah } from "@/lib/pos/cartLogic";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";

interface KasirBiayaTambahanModalProps {
  /** Hasil filterServiceProducts(products). */
  products: ProductWithCategory[];
  cart: CartItem[];
  onAddProduct: (product: ProductWithCategory) => void;
  onClose: () => void;
}

export default function KasirBiayaTambahanModal({
  products,
  cart,
  onAddProduct,
  onClose,
}: KasirBiayaTambahanModalProps) {
  return (
    <Modal size="sm" layout="plain">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <PackagePlus className="h-4 w-4 text-lco-mustard" />
          Biaya Tambahan
        </h3>
        <IconButton
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          size="sm"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Pilih item non-produk untuk ditambahkan ke tagihan.
      </p>

      {products.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 px-3 py-4 text-center text-xs text-zinc-400">
          Belum ada item Biaya Tambahan. Di menu Produk, tandai tipenya
          sebagai <strong>Jasa</strong> (tanpa stok, mis. &quot;Ongkos
          Kirim&quot;) atau centang{" "}
          <strong>Tampilkan di Biaya Tambahan Kasir</strong> untuk barang
          berstok (mis. &quot;Paper Bag&quot;).
        </p>
      ) : (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {products.map((product) => {
            const inCart = cart.find(
              (item) => item.product.id === product.id,
            );
            const soldOut = !product.is_service && product.stock <= 0;
            return (
              <button
                key={product.id}
                disabled={soldOut}
                onClick={() => onAddProduct(product)}
                className="flex items-center justify-between rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-left hover:border-lco-mustard transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-sm font-medium">
                  {product.name}
                  {inCart && (
                    <span className="ml-2 rounded bg-lco-mustard/20 px-1.5 py-0.5 text-[10px] font-bold text-lco-mustard">
                      {inCart.qty}x di keranjang
                    </span>
                  )}
                </span>
                <span className="text-right font-mono text-sm text-zinc-500">
                  {formatRupiah(product.sell_price)}
                  {!product.is_service && (
                    <span
                      className={`block text-[10px] ${soldOut ? "text-lco-coral" : "text-zinc-400"}`}
                    >
                      {soldOut ? "Stok habis" : `Stok: ${product.stock}`}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        onClick={onClose}
        size="lg"
        fullWidth
        className="mt-5"
      >
        Simpan
      </Button>
    </Modal>
  );
}
