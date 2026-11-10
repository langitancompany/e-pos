// hooks/useHoldOrders.ts
// ── TAMBAHAN ── Hook domain Hold Order / "Tunda" (PRD §17 T-11, bagian 1 dari 3):
// baca daftar held order milik kasir yang login dari tabel `held_orders`
// (migration 019), plus aksi tunda/lanjutkan/hapus. Konsumen: KasirModule.tsx.
//
// Pembagian tanggung jawab (pola sama dengan useShifts.ts openShift()):
// - holdOrder(): INSERT langsung dari client, aman tanpa RPC — `items` murni
//   snapshot ringan (product_id + qty), dijaga RLS `held_orders_insert_own`
//   (migration 019). Tidak menyentuh stok produk sama sekali (beda dari
//   createTransaction di lib/pos/transactionApi.ts yang RPC & mengunci stok) —
//   held order BUKAN transaksi sah, jadi stok tetap "available" untuk kasir
//   lain selagi ditunda. Efek sampingnya (SENGAJA diterima, bukan bug): dua
//   kasir bisa menunda produk yang sama sampai stoknya habis kalau salah satu
//   resume duluan — makanya resumeHeldOrder() di bawah validasi ULANG stok
//   terkini, bukan asumsi masih sama seperti saat ditunda.
// - resumeHeldOrder(): TIDAK menyentuh tabel sama sekali kecuali baca +
//   delete. Rehidrasi `items` (cuma product_id+qty) jadi CartItem[] penuh
//   dengan mencocokkan ke `products` TERKINI yang dioper si pemanggil (dari
//   useProducts() yang sudah dipanggil KasirModule) — bukan query ulang di
//   sini, supaya selalu konsisten dengan produk yang sedang dilihat kasir di
//   layar yang sama. Produk yang sudah dihapus/nonaktif/stok kurang dari qty
//   yang ditunda -> dilaporkan lewat `skippedItems`, BUKAN membatalkan seluruh
//   resume (kasir tetap dapat sisa item yang valid, tidak kehilangan semuanya
//   gara-gara satu produk bermasalah).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CartItem, Product } from "@/lib/pos/types";
import {
  addCustomLine,
  customLineError,
  getAvailableStock,
  isCustomPriceProduct,
} from "@/lib/pos/cartLogic";
import { useBranchScope } from "@/hooks/useActiveBranch";
import { branchFilter } from "@/lib/pos/branches";

const supabase = createClient();

// Baris asli tabel `held_orders` (migration 019).
/** Satu baris snapshot. unit_price dan note hanya ada untuk baris produk harga bebas. */
export interface HeldOrderItem {
  product_id: string;
  qty: number;
  unit_price?: number;
  note?: string;
}

export interface HeldOrder {
  id: string;
  cashier_id: string;
  label: string | null;
  items: HeldOrderItem[];
  item_count: number;
  subtotal: number;
  created_at: string;
}

export interface ResumeResult {
  cart: CartItem[];
  /** Nama produk yang TIDAK ikut dikembalikan ke keranjang (dihapus/nonaktif/stok kurang), kosong kalau semua lancar. */
  skippedItems: string[];
}

interface UseHoldOrdersResult {
  heldOrders: HeldOrder[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Simpan keranjang saat ini sebagai held order, `label` opsional (mis. nama pelanggan). */
  holdOrder: (cart: CartItem[], label?: string) => Promise<void>;
  /**
   * Ambil satu held order & ubah jadi CartItem[] siap pakai, tervalidasi ulang
   * terhadap `products` TERKINI (bukan yang di-snapshot saat ditunda — lihat
   * catatan header di atas). Row-nya langsung DIHAPUS dari DB setelah berhasil
   * diambil (held order tidak pernah "dipakai dua kali").
   */
  resumeHeldOrder: (id: string, currentProducts: Product[]) => Promise<ResumeResult>;
  /** Batalkan held order tanpa mengembalikannya ke keranjang. */
  deleteHeldOrder: (id: string) => Promise<void>;
}

export function useHoldOrders(): UseHoldOrdersResult {
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── TAMBAHAN (migration 047) ── Pesanan tertunda dipisah per cabang.
  const { branchId, ready } = useBranchScope();

  const fetchHeldOrders = useCallback(async () => {
    if (!ready) return;
    setIsLoading(true);
    setError(null);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setHeldOrders([]);
      setIsLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("held_orders")
      .select("id, cashier_id, label, items, item_count, subtotal, created_at")
      .eq("cashier_id", authData.user.id)
      .match(branchFilter(branchId))
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setHeldOrders([]);
    } else {
      setHeldOrders((data ?? []) as HeldOrder[]);
    }
    setIsLoading(false);
  }, [branchId, ready]);

  useEffect(() => {
    fetchHeldOrders();
  }, [fetchHeldOrders]);

  const holdOrder = useCallback(
    async (cart: CartItem[], label?: string) => {
      if (cart.length === 0) {
        throw new Error("Keranjang masih kosong, tidak ada yang ditunda.");
      }

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        throw new Error("Sesi login tidak ditemukan. Muat ulang halaman.");
      }

      const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);
      const subtotal = cart.reduce(
        (sum, item) => sum + item.product.sell_price * item.qty,
        0,
      );

      const { error: insertError } = await supabase.from("held_orders").insert({
        cashier_id: authData.user.id,
        ...(branchId ? { branch_id: branchId } : {}),
        label: label?.trim() || null,
        items: cart.map((item) => ({
          product_id: item.product.id,
          qty: item.qty,
          ...(item.note
            ? { unit_price: item.product.sell_price, note: item.note }
            : {}),
        })),
        item_count: itemCount,
        subtotal,
      });

      if (insertError) {
        throw new Error(insertError.message || "Gagal menunda transaksi.");
      }

      await fetchHeldOrders();
    },
    [fetchHeldOrders, branchId],
  );

  const resumeHeldOrder = useCallback(
    async (id: string, currentProducts: Product[]): Promise<ResumeResult> => {
      const { data, error: fetchError } = await supabase
        .from("held_orders")
        .select("id, items")
        .eq("id", id)
        .single();

      if (fetchError || !data) {
        throw new Error("Held order tidak ditemukan, mungkin sudah dihapus.");
      }

      const productMap = new Map(currentProducts.map((p) => [p.id, p]));
      const cart: CartItem[] = [];
      const skippedItems: string[] = [];

      for (const raw of data.items as HeldOrderItem[]) {
        const product = productMap.get(raw.product_id);
        if (!product || !product.is_active) {
          skippedItems.push(`Produk tidak ditemukan (${raw.product_id})`);
          continue;
        }
        // Baris harga bebas dikembalikan dengan harga dan deskripsi yang tersimpan,
        // dicek ulang terhadap aturan produk saat ini (mis. harga minimum baru).
        if (isCustomPriceProduct(product)) {
          const input = {
            price: raw.unit_price ?? 0,
            qty: raw.qty,
            note: raw.note ?? "",
          };
          const problem = customLineError(product, input);
          if (problem) {
            skippedItems.push(`${product.name} (${problem})`);
            continue;
          }
          cart.push(...addCustomLine([], product, input));
          continue;
        }
        const availableStock = getAvailableStock(product);
        const qty = product.is_service
          ? raw.qty
          : Math.min(raw.qty, availableStock);

        if (qty <= 0) {
          skippedItems.push(`${product.name} (stok habis)`);
          continue;
        }
        if (qty < raw.qty) {
          skippedItems.push(
            `${product.name} (diminta ${raw.qty}, tersedia ${qty})`,
          );
        }
        cart.push({ product, qty });
      }

      // Held order sudah "dipakai" — hapus supaya tidak muncul dua kali /
      // tidak bisa di-resume ulang dari sesi lain.
      const { error: deleteError } = await supabase
        .from("held_orders")
        .delete()
        .eq("id", id);

      if (deleteError) {
        // Cart sudah terlanjur dihitung — tetap kembalikan ke pemanggil, tapi
        // beri tahu lewat console supaya kalau ada held order "hantu" yang
        // tersisa, jejaknya kelihatan (bukan gagal total & kasir kehilangan
        // keranjangnya).
        console.error("Gagal menghapus held order setelah resume:", deleteError);
      }

      await fetchHeldOrders();
      return { cart, skippedItems };
    },
    [fetchHeldOrders],
  );

  const deleteHeldOrder = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase
        .from("held_orders")
        .delete()
        .eq("id", id);

      if (deleteError) {
        throw new Error(deleteError.message || "Gagal menghapus held order.");
      }
      await fetchHeldOrders();
    },
    [fetchHeldOrders],
  );

  return {
    heldOrders,
    isLoading,
    error,
    refetch: fetchHeldOrders,
    holdOrder,
    resumeHeldOrder,
    deleteHeldOrder,
  };
}
