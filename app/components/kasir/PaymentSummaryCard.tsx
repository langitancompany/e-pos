"use client";

// app/components/kasir/PaymentSummaryCard.tsx
// ── Dipecah dari PaymentModal.tsx — kartu subtotal, pajak, dan total tagihan.
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import { formatRp } from "./paymentUtils";

export default function PaymentSummaryCard({
  subtotal,
  tax,
  total,
}: {
  subtotal: number;
  tax: number;
  total: number;
}) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/90 p-5 rounded-xl text-center mb-6 border border-zinc-200 dark:border-zinc-800">
      {tax > 0 && (
        <div className="flex flex-col gap-1 mb-3 pb-3 border-b border-dashed border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">{formatRp(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Pajak (PPN)</span>
            <span className="font-mono tabular-nums">{formatRp(tax)}</span>
          </div>
        </div>
      )}
      <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-semibold mb-2">
        Total Tagihan
      </p>
      <p className="text-3xl font-mono tabular-nums font-semibold leading-none text-zinc-900 dark:text-zinc-100">
        {formatRp(total)}
      </p>
    </div>
  );
}
