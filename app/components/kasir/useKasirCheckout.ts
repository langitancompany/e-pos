"use client";

// app/components/kasir/useKasirCheckout.ts
// ── Dipecah dari KasirModule.tsx. Jalur pembayaran Kasir: buka/tutup
// PaymentModal, simpan transaksi (tunggal & split payment), simpan struk
// terakhir, kirim WA, dan cetak struk. Alur & urutan langkah dipindah APA
// ADANYA — hanya penyusunan struk yang dipindah ke lib/pos/kasirLogic.ts.
//
// Urutan di tiap handleConfirm*: (1) tentukan nama/HP efektif, (2) resolve
// pelanggan, (3) createTransaction, (4) segarkan saldo poin, (5) susun struk,
// (6) simpan struk terakhir, (7) reset keranjang/pelanggan/diskon lewat
// `resetAfterSale`, (8) refetch stok. Gagal di langkah mana pun -> pesan
// error tampil & dilempar ulang agar PaymentModal tahu transaksi gagal.

import { useState, type Dispatch, type SetStateAction } from "react";
import type { CartItem } from "@/lib/pos/types";
import type { Customer } from "@/hooks/useCustomers";
import {
  shareReceiptViaWhatsApp,
  type ReceiptData,
} from "@/lib/pos/printLogic";
import {
  createTransaction,
  type CreatedPayment,
  type PaymentMethod,
  type SplitPaymentLine,
} from "@/lib/pos/transactionApi";
import { buildSaleReceipt, summarizeSplitPayment } from "@/lib/pos/kasirLogic";
import { getReceiptBranding } from "./kasirReceiptBranding";
import type {
  KasirUser,
  OutletSettingsValue,
  PosSettings,
  PrintReceiptFn,
} from "./kasirHookTypes";

interface Params {
  cart: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  pointsBeingUsed: number;
  posSettings: PosSettings;
  outlet: OutletSettingsValue;
  user: KasirUser;
  printReceipt: PrintReceiptFn;
  selectedCustomer: Customer | null;
  resolveCustomerId: (
    name?: string,
    phone?: string,
  ) => Promise<string | undefined>;
  refetchCustomers: () => void;
  refetchProducts: () => void | Promise<void>;
  /** Kosongkan keranjang, kembali ke layar Produk, lepas pelanggan & diskon manual. */
  resetAfterSale: () => void;
  setTransactionError: Dispatch<SetStateAction<string | null>>;
}

export interface ConfirmPaymentExtra {
  customerName?: string;
  customerPhone?: string;
  dueDate?: string;
  // Order ID Midtrans yang sudah LUNAS dari PaymentModal (038) — server
  // memverifikasi pembayaran digital lewat ini.
  digitalOrderId?: string;
}

export interface ConfirmSplitExtra {
  customerName?: string;
  customerPhone?: string;
  // Order ID lunas untuk baris DIGITAL di split (038).
  digitalOrderId?: string;
}

export function useKasirCheckout({
  cart,
  subtotal,
  discount,
  tax,
  grandTotal,
  pointsBeingUsed,
  posSettings,
  outlet,
  user,
  printReceipt,
  selectedCustomer,
  resolveCustomerId,
  refetchCustomers,
  refetchProducts,
  resetAfterSale,
  setTransactionError,
}: Params) {
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);

  // Struk transaksi TERAKHIR yang berhasil dibayar + no. HP pelanggan, disimpan
  // di sini (bukan di PaymentModal) supaya tetap tersedia untuk
  // handleSendWhatsApp() walau PaymentModal sempat re-render. null selama
  // belum ada transaksi sukses di sesi Kasir ini.
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [lastCustomerPhone, setLastCustomerPhone] = useState<string | null>(
    null,
  );

  // Dipakai tombol "Bayar"/F8 di mode Tablet & PC — guard-nya satu tempat.
  const handleOpenPayment = () => {
    if (cart.length === 0 || isSavingTransaction) return;
    setTransactionError(null);
    setIsPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    if (!isSavingTransaction) setIsPaymentModalOpen(false);
  };

  const handleConfirmPayment = async (
    method: PaymentMethod,
    paidAmount: number,
    change: number,
    extra?: ConfirmPaymentExtra,
  ): Promise<{ paymentId: string }> => {
    if (cart.length === 0) throw new Error("Keranjang masih kosong.");
    setTransactionError(null);
    setIsSavingTransaction(true);

    try {
      // Pelanggan yang dipilih kasir jadi default, tapi nama/HP yang SEMPAT
      // diketik manual di PaymentModal (`extra`) tetap menang.
      const effectiveCustomerName =
        extra?.customerName || selectedCustomer?.name;
      const effectiveCustomerPhone =
        extra?.customerPhone || selectedCustomer?.phone || undefined;

      const customerId = await resolveCustomerId(
        extra?.customerName,
        extra?.customerPhone,
      );

      const result = await createTransaction({
        items: cart,
        subtotal,
        discount,
        tax,
        total: grandTotal,
        paymentMethod: method,
        paymentAmount: paidAmount,
        receivedAmount: method === "CASH" ? paidAmount : undefined,
        customerName: effectiveCustomerName,
        customerPhone: effectiveCustomerPhone,
        dueDate: extra?.dueDate,
        customerId,
        pointsRedeemed: pointsBeingUsed,
        digitalOrderId: extra?.digitalOrderId,
      });

      // Segarkan saldo poin di daftar pelanggan (server sudah memotong/menambah).
      refetchCustomers();

      const receiptData = buildSaleReceipt({
        branding: getReceiptBranding(posSettings, outlet, { withPromo: true }),
        receiptNo: result.receipt_no,
        createdAt: new Date().toISOString(),
        cashierName: user?.full_name ?? user?.email ?? null,
        customerName: effectiveCustomerName,
        cart,
        subtotal,
        discount,
        tax,
        total: grandTotal,
        paidAmount,
        changeAmount: result.change_amount ?? change,
        method,
      });

      // Cetak otomatis dipicu PaymentModal lewat onPrint saat layar sukses
      // muncul; struk + no. HP disimpan agar "Kirim WA" tahu struk MANA.
      setLastReceipt(receiptData);
      setLastCustomerPhone(effectiveCustomerPhone ?? null);

      resetAfterSale();
      await refetchProducts();
      return { paymentId: result.payment_id };
    } catch (err) {
      console.error("Transaction failed:", err);
      const message =
        err instanceof Error ? err.message : "Transaksi gagal disimpan.";
      setTransactionError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setIsSavingTransaction(false);
    }
  };

  // Versi split payment (021, T-11 bagian 2). Alurnya sengaja semirip mungkin
  // dengan handleConfirmPayment. Bedanya: createTransaction dipanggil dengan
  // `payments` (array); `paidAmount` struk = jumlah SEMUA baris; `method` struk
  // digabung dari semua metode ("Tunai + Digital"); mengembalikan `payments`
  // (id tiap baris pembayaran), bukan `paymentId` tunggal.
  const handleConfirmSplitPayment = async (
    lines: SplitPaymentLine[],
    extra?: ConfirmSplitExtra,
  ): Promise<{ payments: CreatedPayment[] }> => {
    if (cart.length === 0) throw new Error("Keranjang masih kosong.");
    setTransactionError(null);
    setIsSavingTransaction(true);

    try {
      const effectiveCustomerName =
        extra?.customerName || selectedCustomer?.name;
      const effectiveCustomerPhone =
        extra?.customerPhone || selectedCustomer?.phone || undefined;

      const customerId = await resolveCustomerId(
        extra?.customerName,
        extra?.customerPhone,
      );

      const result = await createTransaction({
        items: cart,
        subtotal,
        discount,
        tax,
        total: grandTotal,
        payments: lines,
        customerName: effectiveCustomerName,
        customerPhone: effectiveCustomerPhone,
        customerId,
        pointsRedeemed: pointsBeingUsed,
        digitalOrderId: extra?.digitalOrderId,
      });

      refetchCustomers();

      const { totalPaid, methodLabel } = summarizeSplitPayment(lines);

      const receiptData = buildSaleReceipt({
        branding: getReceiptBranding(posSettings, outlet, { withPromo: true }),
        receiptNo: result.receipt_no,
        createdAt: new Date().toISOString(),
        cashierName: user?.full_name ?? user?.email ?? null,
        customerName: effectiveCustomerName,
        cart,
        subtotal,
        discount,
        tax,
        total: grandTotal,
        paidAmount: totalPaid,
        changeAmount: result.change_amount ?? 0,
        method: methodLabel,
      });

      setLastReceipt(receiptData);
      setLastCustomerPhone(effectiveCustomerPhone ?? null);

      resetAfterSale();
      await refetchProducts();
      return { payments: result.payments };
    } catch (err) {
      console.error("Split transaction failed:", err);
      const message =
        err instanceof Error ? err.message : "Transaksi gagal disimpan.";
      setTransactionError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setIsSavingTransaction(false);
    }
  };

  // Dipanggil PaymentModal saat kasir menekan "Kirim Struk via WhatsApp" di
  // layar sukses. Pakai lastReceipt/lastCustomerPhone dari state karena
  // tombolnya baru bisa diklik SETELAH createTransaction() selesai.
  const handleSendWhatsApp = async () => {
    if (!lastReceipt) {
      throw new Error(
        "Data struk tidak ditemukan. Muat ulang halaman lalu coba lagi.",
      );
    }
    return shareReceiptViaWhatsApp(lastReceipt, lastCustomerPhone);
  };

  // Dipanggil OTOMATIS oleh PaymentModal saat layar sukses muncul, selalu ke
  // printer thermal. Aman dipanggil berulang (mis. kertas macet).
  const handlePrintReceipt = () => {
    if (!lastReceipt) return;
    // Tidak perlu await: kegagalan printer sudah terlihat dari status printer
    // di Pengaturan > Printer.
    void printReceipt(lastReceipt);
  };

  return {
    isPaymentModalOpen,
    isSavingTransaction,
    lastReceipt,
    handleOpenPayment,
    closePaymentModal,
    handleConfirmPayment,
    handleConfirmSplitPayment,
    handleSendWhatsApp,
    handlePrintReceipt,
  };
}
