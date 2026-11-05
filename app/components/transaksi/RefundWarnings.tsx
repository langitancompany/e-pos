"use client";

// app/components/transaksi/RefundWarnings.tsx
// ── Dipecah dari TransactionDetailModal.tsx — peringatan refund yang tidak otomatis selesai.
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { AlertTriangle } from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";

// ── TAMBAHAN (migration 037) ── Peringatan untuk refund yang TIDAK otomatis
// selesai di sistem. Dipakai di riwayat retur (transaksi penjualan) dan di
// detail baris retur itu sendiri.
export default function RefundWarnings({
  digital,
  unrecorded,
  digitalRefs,
  tempoSettled,
}: {
  digital: number;
  unrecorded: number;
  /** Order ID Midtrans pembayaran digital transaksi asli (kalau diketahui). */
  digitalRefs?: string[];
  /** Piutang transaksi asli sudah lunas? undefined = tidak diketahui. */
  tempoSettled?: boolean;
}) {
  if (digital <= 0 && unrecorded <= 0) return null;

  return (
    <div className="space-y-2">
      {digital > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-lco-mustard/40 bg-lco-mustard/10 p-3 text-xs text-zinc-800 dark:text-zinc-100">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-lco-mustard" />
          <div className="space-y-1">
            <p className="font-semibold">
              Refund digital {formatRupiah(digital)} harus diproses manual
            </p>
            <p>
              Sistem hanya mencatat refund ini. Dana BELUM otomatis kembali ke
              pelanggan — kembalikan lewat dashboard Midtrans.
              {digitalRefs && digitalRefs.length > 0 && (
                <>
                  {" "}
                  Order ID:{" "}
                  <span className="font-mono">{digitalRefs.join(", ")}</span>
                </>
              )}
            </p>
          </div>
        </div>
      )}
      {unrecorded > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-lco-mustard/40 bg-lco-mustard/10 p-3 text-xs text-zinc-800 dark:text-zinc-100">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-lco-mustard" />
          <div className="space-y-1">
            <p className="font-semibold">
              {formatRupiah(unrecorded)} berasal dari bagian piutang
            </p>
            <p>
              Tagihan piutang TIDAK otomatis berkurang oleh retur ini.{" "}
              {tempoSettled === true
                ? "Piutang transaksi ini sudah dilunasi, jadi kembalikan dana bagian ini ke pelanggan secara manual."
                : tempoSettled === false
                  ? "Tagihan masih tercatat penuh — sesuaikan secara manual dengan pelanggan."
                  : "Sesuaikan tagihan piutang pelanggan secara manual."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
