"use client";

// app/components/kasir/useKasirCart.ts
// ── Dipecah dari KasirModule.tsx. Memegang state keranjang beserta semua jalur
// yang menambah/mengubah isinya: tap produk, kolom kode mode PC ("qty*kode"),
// dan scan barcode kamera. Aturan keranjang tetap di lib/pos/cartLogic.ts,
// pencocokan kode/barcode di lib/pos/kasirLogic.ts.
//
// `setTransactionError` dioper dari luar karena setiap perubahan keranjang
// harus menghapus pesan "Transaksi gagal" sebelumnya (state itu dipakai juga
// oleh useKasirCheckout).

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { CartItem } from "@/lib/pos/types";
import type { ProductWithCategory } from "@/hooks/useProducts";
import {
  addToCart,
  clearCart,
  removeFromCart,
  updateQty,
} from "@/lib/pos/cartLogic";
import { resolveBarcodeScan, resolvePcCode } from "@/lib/pos/kasirLogic";
import type { ScanFeedback } from "./BarcodeScanModal";

interface Params {
  products: ProductWithCategory[];
  setTransactionError: Dispatch<SetStateAction<string | null>>;
}

export function useKasirCart({ products, setTransactionError }: Params) {
  const [cart, setCart] = useState<CartItem[]>([]);

  // ── Mode PC ── baris keranjang yang sedang "disorot" (dinavigasi ↑↓) dan
  // pesan error kolom kode.
  const [pcSelectedProductId, setPcSelectedProductId] = useState<string | null>(
    null,
  );
  const [pcCodeError, setPcCodeError] = useState<string | null>(null);

  // ── Scan barcode kamera ──
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);

  const handleAddToCart = (product: ProductWithCategory) => {
    setTransactionError(null);
    setCart((prev) => addToCart(prev, product));
  };
  const handleUpdateQty = (productId: string, delta: number) => {
    setTransactionError(null);
    setCart((prev) => updateQty(prev, productId, delta));
  };
  const handleRemoveFromCart = (productId: string) => {
    setTransactionError(null);
    setCart((prev) => removeFromCart(prev, productId));
  };

  // Modal Biaya Tambahan: tambah 1 item ke keranjang TANPA menghapus pesan
  // "Transaksi gagal" (perilaku asli modal ini, beda dari tap produk biasa).
  const handleAddExtraCharge = (product: ProductWithCategory) => {
    setCart((prev) => addToCart(prev, product));
  };

  // Dipakai dua jalur: Enter di kolom kode (kode persis cocok) DAN memilih
  // salah satu saran produk saat kasir mengetik nama/kode sebagian.
  const handlePcAddProduct = (product: ProductWithCategory, qty: number) => {
    setPcCodeError(null);
    setTransactionError(null);
    setCart((prev) => {
      let next = addToCart(prev, product);
      if (qty > 1) next = updateQty(next, product.id, qty - 1);
      return next;
    });
    setPcSelectedProductId(product.id);
  };

  const handlePcCodeSubmit = (raw: string) => {
    const result = resolvePcCode(products, raw);
    if (result.kind === "empty") return;
    if (result.kind === "error") {
      setPcCodeError(result.message);
      return;
    }
    handlePcAddProduct(result.product, result.qty);
  };

  /** Kosongkan keranjang + lepas sorotan baris (mode PC: tombol Bersihkan / F5). */
  const clearCartAndSelection = () => {
    setCart(clearCart());
    setPcSelectedProductId(null);
  };

  // Dipanggil BarcodeScanModal setiap kamera berhasil baca satu barcode.
  // Dicocokkan ke `products` yang SUDAH dimuat (bukan query baru tiap scan).
  // `useCallback` dengan dependensi [products, cart] supaya BarcodeScanModal
  // (yang memakai fungsi ini sebagai dependency effect kamera) tidak restart
  // kamera tiap render, hanya saat daftar produk / isi keranjang berubah.
  const handleBarcodeScanned = useCallback(
    (rawCode: string) => {
      const { feedback, productToAdd } = resolveBarcodeScan(
        products,
        cart,
        rawCode,
      );
      if (productToAdd) {
        setTransactionError(null);
        setCart((prev) => addToCart(prev, productToAdd));
      }
      setScanFeedback(feedback);

      // Feedback transien — hilang sendiri sebelum kamera aktif lagi
      // (BarcodeScanModal resume ~1200ms), supaya tidak menumpuk pesan lama.
      setTimeout(() => setScanFeedback(null), 1800);
    },
    [products, cart, setTransactionError],
  );

  const openScanModal = () => {
    setScanFeedback(null);
    setIsScanModalOpen(true);
  };
  const closeScanModal = () => setIsScanModalOpen(false);

  return {
    cart,
    setCart,
    handleAddToCart,
    handleUpdateQty,
    handleRemoveFromCart,
    handleAddExtraCharge,
    pcSelectedProductId,
    setPcSelectedProductId,
    pcCodeError,
    setPcCodeError,
    handlePcAddProduct,
    handlePcCodeSubmit,
    clearCartAndSelection,
    isScanModalOpen,
    scanFeedback,
    openScanModal,
    closeScanModal,
    handleBarcodeScanned,
  };
}
