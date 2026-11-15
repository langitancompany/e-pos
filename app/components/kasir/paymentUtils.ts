// app/components/kasir/paymentUtils.ts
// ── Dipecah dari PaymentModal.tsx — konstanta & helper murni (tanpa state
// React) yang dipakai PaymentModal beserta komponen-komponen pecahannya.

import { Wallet, QrCode, CalendarClock } from "lucide-react";
import type { PaymentMethod } from "@/lib/pos/transactionApi";

// ── TAMBAHAN (bug: preview tidak sama dengan hasil cetak) ── Duplikat kecil
// dari METHOD_LABELS/formatMethod() di printLogic.ts (tidak diexport dari
// sana, dan sengaja tidak diimport langsung supaya PaymentModal tetap tidak
// punya dependency RUNTIME ke printLogic.ts — lihat catatan di atas soal
// `import type` ReceiptData). Kalau labelnya diubah di printLogic.ts, ubah
// juga di sini supaya preview & hasil cetak tetap sama persis.
// ── PERUBAHAN (metode bayar disederhanakan) ── Sekarang hanya 3 metode:
// Tunai (CASH), Digital (DIGITAL), Piutang (TEMPO). Key lama (tunai/transfer/
// BANK_TRANSFER/QRIS) sengaja dibiarkan sebagai fallback label supaya baris
// lama yang belum termigrasi (migration 034) tidak tampil sebagai teks mentah.
export const PREVIEW_METHOD_LABELS: Record<string, string> = {
  CASH: "Tunai",
  DIGITAL: "Digital",
  TEMPO: "Piutang",
  tunai: "Tunai",
  transfer: "Digital",
  BANK_TRANSFER: "Digital",
  QRIS: "Digital",
};

export function formatMethodLabel(method: string): string {
  return PREVIEW_METHOD_LABELS[method] ?? method.toUpperCase();
}

export const METHODS: {
  value: PaymentMethod;
  label: string;
  icon: typeof Wallet;
}[] = [
  { value: "CASH", label: "Tunai", icon: Wallet },
  { value: "DIGITAL", label: "Digital", icon: QrCode },
  { value: "TEMPO", label: "Piutang", icon: CalendarClock },
];

// ── TAMBAHAN (021) ── Urutan tampil & urutan baris yang dikirim ke RPC pada mode split.
export const SPLIT_ORDER: PaymentMethod[] = ["CASH", "DIGITAL", "TEMPO"];

export function emptyMethodFlags(): Record<PaymentMethod, boolean> {
  return { CASH: false, DIGITAL: false, TEMPO: false };
}

export function emptyMethodAmounts(): Record<PaymentMethod, number> {
  return { CASH: 0, DIGITAL: 0, TEMPO: 0 };
}

export function methodLabel(method: PaymentMethod): string {
  return METHODS.find((m) => m.value === method)?.label ?? method;
}

// ── TAMBAHAN (Midtrans) ── Dilempar saat kasir sengaja membatalkan pembayaran
// digital. Bukan kegagalan, jadi tidak ditampilkan sebagai banner error.
export class DigitalCancelledError extends Error {
  constructor() {
    super("Pembayaran digital dibatalkan.");
    this.name = "DigitalCancelledError";
  }
}

// Teks status Midtrans untuk kasir (nilai mentah tetap muncul kalau tak dikenal).
export function digitalStatusLabel(midtransStatus: string | null): string {
  if (!midtransStatus) return "Pelanggan belum memilih metode bayar";
  switch (midtransStatus) {
    case "pending":
      return "Menunggu pembayaran";
    case "settlement":
    case "capture":
      return "Lunas";
    case "expire":
      return "Kedaluwarsa";
    case "cancel":
      return "Dibatalkan";
    case "deny":
    case "failure":
      return "Ditolak";
    default:
      return midtransStatus;
  }
}

export function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export const formatRp = (angka: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(angka);
};
