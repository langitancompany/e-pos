"use client";

// app/components/kasir/useKasirHold.ts
// ── Dipecah dari KasirModule.tsx. Hold order / "Tunda" (T-11 bagian 1): modal
// konfirmasi Tunda (isi label opsional) + modal daftar pesanan tertunda
// (lanjutkan / hapus). Pembagian tanggung jawab dengan hooks/useHoldOrders.ts
// tidak berubah — hook ini hanya menampung state UI-nya. Isi dipindah apa adanya.

import { useState, type Dispatch, type SetStateAction } from "react";
import type { CartItem } from "@/lib/pos/types";
import type { ProductWithCategory } from "@/hooks/useProducts";
import { useHoldOrders } from "@/hooks/useHoldOrders";
import { clearCart } from "@/lib/pos/cartLogic";

interface Params {
  cart: CartItem[];
  products: ProductWithCategory[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setMobileView: (view: "products" | "cart") => void;
  setTransactionError: Dispatch<SetStateAction<string | null>>;
}

export function useKasirHold({
  cart,
  products,
  setCart,
  setMobileView,
  setTransactionError,
}: Params) {
  const {
    heldOrders,
    isLoading: isHeldOrdersLoading,
    holdOrder,
    resumeHeldOrder,
    deleteHeldOrder,
    refetch: refetchHeldOrders,
  } = useHoldOrders();

  // Modal konfirmasi "Tunda"
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  const [isHolding, setIsHolding] = useState(false);
  const [holdModalError, setHoldModalError] = useState<string | null>(null);

  // Modal daftar held order
  const [isHeldListOpen, setIsHeldListOpen] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [heldListError, setHeldListError] = useState<string | null>(null);
  // Info non-fatal ("2 item disesuaikan karena stok berkurang") setelah resume —
  // dipisah dari transactionError (kegagalan pembayaran) supaya warnanya beda
  // (peringatan kuning, bukan merah) & tidak saling menimpa.
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  const openHoldModal = () => {
    if (cart.length === 0) return;
    setHoldModalError(null);
    setHoldLabel("");
    setIsHoldModalOpen(true);
  };

  const closeHoldModal = () => setIsHoldModalOpen(false);

  const handleConfirmHold = async () => {
    setIsHolding(true);
    setHoldModalError(null);
    try {
      await holdOrder(cart, holdLabel);
      setCart(clearCart());
      setMobileView("products");
      setIsHoldModalOpen(false);
    } catch (err) {
      setHoldModalError(
        err instanceof Error ? err.message : "Gagal menunda transaksi.",
      );
    } finally {
      setIsHolding(false);
    }
  };

  const openHeldList = () => {
    setHeldListError(null);
    setIsHeldListOpen(true);
    refetchHeldOrders();
  };

  const closeHeldList = () => setIsHeldListOpen(false);

  const handleResumeHeldOrder = async (id: string) => {
    // Melanjutkan held order MENIMPA keranjang aktif — kalau keranjang sedang
    // tidak kosong, kasir harus sadar dulu isinya bakal diganti.
    if (
      cart.length > 0 &&
      !window.confirm(
        "Keranjang saat ini belum kosong dan akan diganti dengan pesanan yang ditunda. Lanjutkan?",
      )
    ) {
      return;
    }

    setResumingId(id);
    setHeldListError(null);
    try {
      const result = await resumeHeldOrder(id, products);
      setCart(result.cart);
      setMobileView("cart");
      setTransactionError(null);
      setResumeNotice(
        result.skippedItems.length > 0
          ? `Beberapa item disesuaikan karena stok/produk berubah: ${result.skippedItems.join(", ")}`
          : null,
      );
      setIsHeldListOpen(false);
    } catch (err) {
      setHeldListError(
        err instanceof Error ? err.message : "Gagal melanjutkan pesanan.",
      );
    } finally {
      setResumingId(null);
    }
  };

  const handleDeleteHeldOrder = async (id: string) => {
    if (!window.confirm("Hapus pesanan tertunda ini? Tidak bisa dibatalkan.")) {
      return;
    }
    setResumingId(id);
    setHeldListError(null);
    try {
      await deleteHeldOrder(id);
    } catch (err) {
      setHeldListError(
        err instanceof Error ? err.message : "Gagal menghapus pesanan.",
      );
    } finally {
      setResumingId(null);
    }
  };

  return {
    heldOrders,
    isHeldOrdersLoading,
    // modal Tunda
    isHoldModalOpen,
    holdLabel,
    setHoldLabel,
    isHolding,
    holdModalError,
    openHoldModal,
    closeHoldModal,
    handleConfirmHold,
    // modal daftar tertunda
    isHeldListOpen,
    resumingId,
    heldListError,
    openHeldList,
    closeHeldList,
    handleResumeHeldOrder,
    handleDeleteHeldOrder,
    // info setelah resume
    resumeNotice,
    dismissResumeNotice: () => setResumeNotice(null),
  };
}
