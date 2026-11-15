"use client";

// app/components/kasir/PaymentFooter.tsx
// ── Dipecah dari PaymentModal.tsx — tombol proses pembayaran di footer modal.
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import { Loader2 } from "lucide-react";
import type { PaymentMethod } from "@/lib/pos/transactionApi";
import Button from "@/app/components/ui/Button";
import { formatRp } from "./paymentUtils";

export default function PaymentFooter({
  onSubmit,
  isPayable,
  isProcessing,
  isSplit,
  splitError,
  method,
  changeAmount,
  hasPaidDigital,
  splitDigitalOn,
  digitalPhase,
}: {
  onSubmit: () => void;
  isPayable: boolean;
  isProcessing: boolean;
  isSplit: boolean;
  splitError: string | null;
  method: PaymentMethod;
  changeAmount: number;
  /** Pembayaran digital sudah lunas tapi transaksi belum tersimpan. */
  hasPaidDigital: boolean;
  /** Mode split: baris Digital ikut dipilih. */
  splitDigitalOn: boolean;
  digitalPhase: "idle" | "creating" | "waiting";
}) {
  return (
    <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
      <Button
        onClick={onSubmit}
        disabled={!isPayable || isProcessing}
        size="lg"
        fullWidth
      >
        {digitalPhase !== "idle" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Menunggu Pembayaran Digital...
          </>
        ) : isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Menyimpan Transaksi...
          </>
        ) : isSplit && splitError ? (
          splitError
        ) : !isSplit && method === "CASH" && !isPayable ? (
          `Uang Kurang ( ${formatRp(Math.abs(changeAmount))} )`
        ) : !isSplit && method === "TEMPO" && !isPayable ? (
          "Lengkapi Nama & Jatuh Tempo"
        ) : hasPaidDigital ? (
          "Simpan Transaksi (Digital Sudah Lunas)"
        ) : (isSplit ? splitDigitalOn : method === "DIGITAL") ? (
          "Lanjut ke Pembayaran Digital"
        ) : (
          "Proses Pembayaran"
        )}
      </Button>
    </div>
  );
}
