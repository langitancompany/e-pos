"use client";

// app/components/transaksi/ReturnPanel.tsx
// ── Dipecah dari TransactionDetailModal.tsx — panel form retur (pratinjau dana kembali + alasan).
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { Info, Loader2 } from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import type { estimateReturn } from "@/lib/pos/returnPreview";
import type { TransactionDetail } from "@/lib/pos/transactionApi";
import Button from "@/app/components/ui/Button";

export default function ReturnPanel({
  detail,
  returnEstimate,
  returnReason,
  onReasonChange,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  detail: TransactionDetail;
  returnEstimate: ReturnType<typeof estimateReturn> | null;
  returnReason: string;
  onReasonChange: (value: string) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-lco-mustard/40 bg-lco-mustard/10 p-4">
      {/* ── TAMBAHAN (037/039) ── Pratinjau dana kembali. Angka final
                    dihitung server; bisa beda beberapa rupiah (pembulatan). */}
      <div className="rounded-md border border-lco-mustard/30 bg-white/60 dark:bg-zinc-950/60 p-3 text-xs space-y-1.5">
        {returnEstimate && returnEstimate.refundTotal > 0 ? (
          <>
            <div className="flex justify-between font-semibold text-zinc-900 dark:text-zinc-100">
              <span>Perkiraan dana kembali</span>
              <span className="font-mono tabular-nums">
                {formatRupiah(returnEstimate.refundTotal)}
              </span>
            </div>
            {returnEstimate.cash > 0 && (
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Tunai (dari laci kasir)</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(returnEstimate.cash)}
                </span>
              </div>
            )}
            {returnEstimate.digital > 0 && (
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Digital (proses manual di Midtrans)</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(returnEstimate.digital)}
                </span>
              </div>
            )}
            {returnEstimate.unrecorded > 0 && (
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Bagian piutang (tagihan tidak otomatis berkurang)</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(returnEstimate.unrecorded)}
                </span>
              </div>
            )}
            {returnEstimate.cash > 0 && (
              <p className="flex items-start gap-1.5 text-zinc-500 pt-1">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                Retur tunai butuh shift kasir yang sedang terbuka.
              </p>
            )}
            {(detail.points_earned > 0 || detail.points_redeemed > 0) && (
              <p className="flex items-start gap-1.5 text-zinc-500">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                Poin pelanggan ikut disesuaikan: poin yang didapat dicabut dan
                poin yang dipakai dikembalikan, sebanding dengan barang yang
                diretur.
              </p>
            )}
            <p className="text-[10px] text-zinc-400">
              Perkiraan — angka final dihitung server dan bisa berbeda beberapa
              rupiah karena pembulatan.
            </p>
          </>
        ) : (
          <p className="text-zinc-500">
            Isi jumlah barang yang diretur untuk melihat perkiraan dana kembali.
          </p>
        )}
      </div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Alasan Retur
      </label>
      <textarea
        value={returnReason}
        onChange={(e) => onReasonChange(e.target.value)}
        rows={2}
        placeholder="Contoh: ukuran tidak sesuai, barang cacat, dll."
        className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal"
      />
      <div className="flex gap-3">
        <Button
          onClick={onCancel}
          disabled={isSubmitting}
          variant="secondary"
          size="sm"
          className="flex-1"
        >
          Batal
        </Button>
        <Button
          onClick={onSubmit}
          disabled={isSubmitting}
          size="sm"
          className="flex-1"
        >
          {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Proses Retur
        </Button>
      </div>
    </div>
  );
}
