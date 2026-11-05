"use client";

// app/components/kasir/KasirCartPanel.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Panel Keranjang (mode Tablet): daftar item + ubah qty, pesan gagal transaksi,
// info non-fatal setelah melanjutkan pesanan tertunda, ringkasan Subtotal /
// Pajak / Total, dan tombol Tunda & Bayar. Di bawah `md` panel ini adalah
// "layar" kedua (toggle `mobileView`) dengan tombol kembali ke Produk.

import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  CreditCard,
  History,
  Loader2,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import type { CartItem } from "@/lib/pos/types";
import {
  formatRupiah,
  getAvailableStock,
  getCartItemCount,
} from "@/lib/pos/cartLogic";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";

interface KasirCartPanelProps {
  mobileView: "products" | "cart";
  onBackToProducts: () => void;
  /** Jumlah pesanan tertunda (badge di ikon riwayat). */
  heldCount: number;
  onOpenHeldList: () => void;
  cart: CartItem[];
  onUpdateQty: (productId: string, delta: number) => void;
  onRemoveFromCart: (productId: string) => void;
  transactionError: string | null;
  resumeNotice: string | null;
  onDismissResumeNotice: () => void;
  subtotal: number;
  tax: number;
  ppnRate: number;
  grandTotal: number;
  isSavingTransaction: boolean;
  onHold: () => void;
  onPay: () => void;
}

export default function KasirCartPanel({
  mobileView,
  onBackToProducts,
  heldCount,
  onOpenHeldList,
  cart,
  onUpdateQty,
  onRemoveFromCart,
  transactionError,
  resumeNotice,
  onDismissResumeNotice,
  subtotal,
  tax,
  ppnRate,
  grandTotal,
  isSavingTransaction,
  onHold,
  onPay,
}: KasirCartPanelProps) {
  return (
    <div
      className={`${mobileView === "cart" ? "flex" : "hidden"} md:flex w-full md:w-[320px] lg:w-[380px] xl:w-[420px] flex-col min-h-0 bg-white dark:bg-zinc-950`}
    >
      <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* ── TAMBAHAN (responsif HP) ── Tombol kembali ke layar Produk;
          disembunyikan di `md` ke atas karena di sana panel Produk
          sudah selalu terlihat di sebelah. */}
          <IconButton
            type="button"
            onClick={onBackToProducts}
            title="Kembali ke Produk"
            aria-label="Kembali ke Produk"
            variant="soft"
            className="md:hidden -ml-1"
          >
            <ArrowLeft className="w-4 h-4" />
          </IconButton>
          <h2 className="font-semibold text-base tracking-tight flex items-center gap-2 text-zinc-900 dark:text-zinc-100 truncate">
            <ShoppingCart className="w-5 h-5 text-lco-teal shrink-0" />
            Keranjang
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* ── TAMBAHAN (T-11 bagian 1) ── Lihat & lanjutkan pesanan yang ditunda. */}
          <button
            onClick={onOpenHeldList}
            className="relative flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 hover:text-lco-mustard text-[11px] px-2.5 py-1 rounded-full font-mono border border-zinc-200 dark:border-zinc-800 transition-colors duration-150"
            title="Pesanan Tertunda"
          >
            <History className="w-3.5 h-3.5" />
            {heldCount > 0 && (
              <span className="tabular-nums">{heldCount}</span>
            )}
          </button>
          <span className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 text-[11px] px-2.5 py-1 rounded-full font-mono tabular-nums border border-zinc-200 dark:border-zinc-800">
            {getCartItemCount(cart)} Item
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-zinc-50/50 dark:bg-zinc-900/30">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 bg-zinc-50 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4 border border-zinc-200 dark:border-zinc-800">
              <ShoppingCart className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
            </div>
            <p className="text-zinc-500 text-xs">
              Belum ada produk di keranjang.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {cart.map((item) => (
              <div
                key={item.product.id}
                className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex gap-3"
              >
                <div className="flex-1">
                  <h4 className="text-sm font-medium line-clamp-1 text-zinc-900 dark:text-zinc-100">
                    {item.product.name}
                  </h4>
                  <p className="font-mono tabular-nums text-xs text-zinc-500 mt-0.5">
                    {formatRupiah(item.product.sell_price)}
                  </p>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-zinc-50 dark:bg-zinc-900 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-800">
                      <IconButton
                        onClick={() =>
                          onUpdateQty(item.product.id, -1)
                        }
                        aria-label="Kurangi jumlah"
                        variant="soft"
                        size="sm"
                      >
                        <Minus className="w-3 h-3" />
                      </IconButton>
                      <span className="w-6 text-center font-mono text-xs tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                        {item.qty}
                      </span>
                      <IconButton
                        onClick={() =>
                          onUpdateQty(item.product.id, 1)
                        }
                        disabled={
                          item.qty >= getAvailableStock(item.product)
                        }
                        aria-label="Tambah jumlah"
                        variant="soft"
                        size="sm"
                      >
                        <Plus className="w-3 h-3" />
                      </IconButton>
                    </div>
                    <IconButton
                      onClick={() =>
                        onRemoveFromCart(item.product.id)
                      }
                      aria-label="Hapus dari keranjang"
                      variant="soft"
                      tone="danger"
                    >
                      <Trash2 className="w-4 h-4" />
                    </IconButton>
                  </div>
                  <p className="font-mono text-sm font-semibold text-lco-teal mt-2 tabular-nums">
                    {formatRupiah(item.product.sell_price * item.qty)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {transactionError && (
        <div className="mx-5 mb-3 p-3 rounded-md border border-lco-coral/30 bg-lco-coral/5 text-lco-coral text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Transaksi gagal</p>
              <p>{transactionError}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── TAMBAHAN (T-11 bagian 1) ── Info non-fatal setelah resume held order
      (mis. item disesuaikan karena stok berubah) — warna kuning/mustard,
      beda dari transactionError merah, supaya kasir tidak salah kira ada
      transaksi yang gagal. */}
      {resumeNotice && (
        <div className="mx-5 mb-3 p-3 rounded-md border border-lco-mustard/30 bg-lco-mustard/5 text-lco-mustard text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="flex-1">{resumeNotice}</p>
          <button
            type="button"
            aria-label="Tutup pemberitahuan"
            onClick={onDismissResumeNotice}
            className="shrink-0 hover:opacity-70"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="p-4 sm:p-5 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 z-10">
        <div className="space-y-1.5 mb-5 text-sm">
          <div className="flex justify-between text-zinc-500">
            <span className="text-xs">Subtotal</span>
            <span className="font-mono tabular-nums">
              {formatRupiah(subtotal)}
            </span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between text-zinc-500">
              <span className="text-xs">
                Pajak (PPN {ppnRate}%)
              </span>
              <span className="font-mono tabular-nums">
                {formatRupiah(tax)}
              </span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-lg pt-3 border-t border-zinc-200 dark:border-zinc-800 mt-3 text-zinc-900 dark:text-zinc-100">
            <span>Total</span>
            <span className="font-mono tabular-nums text-lco-teal">
              {formatRupiah(grandTotal)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Button
            disabled={cart.length === 0 || isSavingTransaction}
            onClick={onHold}
            variant="secondary"
            size="lg"
            className="col-span-1"
          >
            <Clock className="w-4 h-4" />
            <span className="text-xs">Tunda</span>
          </Button>
          <Button
            disabled={cart.length === 0 || isSavingTransaction}
            onClick={onPay}
            size="lg"
            className="col-span-2"
          >
            {isSavingTransaction ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Menyimpan...</span>
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                <span className="text-sm">Bayar Sekarang</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
