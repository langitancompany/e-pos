"use client";

// app/components/transaksi/DetailTotals.tsx
// ── Dipecah dari TransactionDetailModal.tsx — subtotal, total, rincian pembayaran, dan poin.
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { formatRupiah } from "@/lib/pos/cartLogic";
import type { TransactionDetail } from "@/lib/pos/transactionApi";
import { formatDate, methodLabel } from "./transactionDetailUtils";

export default function DetailTotals({
  detail,
  isReturnRow,
}: {
  detail: TransactionDetail;
  isReturnRow: boolean;
}) {
  return (
    <div className="space-y-1.5 text-sm border-t border-zinc-200 dark:border-zinc-800 pt-4">
      <div className="flex justify-between text-zinc-500 text-xs">
        <span>{isReturnRow ? "Nilai barang diretur" : "Subtotal"}</span>
        <span className="font-mono tabular-nums">
          {formatRupiah(detail.subtotal)}
        </span>
      </div>
      {detail.discount > 0 && (
        <div className="flex justify-between text-zinc-500 text-xs">
          <span>Diskon</span>
          <span className="font-mono tabular-nums">
            -{formatRupiah(detail.discount)}
          </span>
        </div>
      )}
      {detail.tax > 0 && (
        <div className="flex justify-between text-zinc-500 text-xs">
          <span>Pajak</span>
          <span className="font-mono tabular-nums">
            {formatRupiah(detail.tax)}
          </span>
        </div>
      )}
      <div className="flex justify-between font-semibold text-base pt-2">
        <span>{isReturnRow ? "Dana dikembalikan" : "Total"}</span>
        <span className="font-mono tabular-nums text-lco-teal">
          {formatRupiah(isReturnRow ? Math.abs(detail.total) : detail.total)}
        </span>
      </div>
      {detail.payments.map((payment) => (
        <div
          key={payment.id}
          className="pt-2 flex flex-col gap-2 border-t border-zinc-100 dark:border-zinc-800/50 mt-2 first:border-0 first:mt-0"
        >
          <div className="flex justify-between text-zinc-500 text-xs">
            <span>
              {isReturnRow
                ? `Refund ${methodLabel(payment.method)}`
                : methodLabel(payment.method)}
            </span>
            <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatRupiah(
                isReturnRow ? Math.abs(payment.amount) : payment.amount,
              )}
            </span>
          </div>
          {payment.method === "TEMPO" && payment.due_date && (
            <div className="flex justify-between text-zinc-500 text-xs">
              <span>Jatuh Tempo</span>
              <span className="font-mono tabular-nums text-lco-coral font-medium">
                {formatDate(payment.due_date).split(" ")[0]}
              </span>
            </div>
          )}
          {isReturnRow && payment.notes && (
            <p className="text-[11px] text-zinc-400">{payment.notes}</p>
          )}
        </div>
      ))}
      {!isReturnRow &&
        (detail.points_earned > 0 || detail.points_redeemed > 0) && (
          <div className="flex justify-between text-zinc-500 text-xs pt-2 border-t border-zinc-100 dark:border-zinc-800/50 mt-2">
            <span>Poin</span>
            <span className="font-mono tabular-nums">
              {detail.points_earned > 0 && `+${detail.points_earned} didapat`}
              {detail.points_earned > 0 && detail.points_redeemed > 0 && " · "}
              {detail.points_redeemed > 0 &&
                `-${detail.points_redeemed} dipakai`}
            </span>
          </div>
        )}
    </div>
  );
}
