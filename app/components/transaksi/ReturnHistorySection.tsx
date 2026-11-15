"use client";

// app/components/transaksi/ReturnHistorySection.tsx
// ── Dipecah dari TransactionDetailModal.tsx — peringatan refund + riwayat retur transaksi.
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { formatRupiah } from "@/lib/pos/cartLogic";
import type { TransactionDetail } from "@/lib/pos/transactionApi";
import type { summarizeReturns } from "@/lib/pos/returnPreview";
import RefundWarnings from "./RefundWarnings";
import { formatDate, methodLabel } from "./transactionDetailUtils";

type ReturnsSummary = ReturnType<typeof summarizeReturns>;

export default function ReturnHistorySection({
  isReturnRow,
  returnRowSummary,
  returnList,
  returnsSummary,
  digitalRefs,
  tempoSettled,
}: {
  isReturnRow: boolean;
  /** Ringkasan untuk baris retur itu sendiri (null kalau bukan baris retur). */
  returnRowSummary: ReturnsSummary | null;
  returnList: TransactionDetail["returns"];
  returnsSummary: ReturnsSummary | null;
  digitalRefs: string[];
  tempoSettled: boolean | undefined;
}) {
  return (
    <>
      {isReturnRow && returnRowSummary && (
        <RefundWarnings
          digital={returnRowSummary.digital}
          unrecorded={returnRowSummary.unrecorded}
        />
      )}

      {!isReturnRow && returnList.length > 0 && returnsSummary && (
        <div className="space-y-3">
          <RefundWarnings
            digital={returnsSummary.digital}
            unrecorded={returnsSummary.unrecorded}
            digitalRefs={digitalRefs}
            tempoSettled={tempoSettled}
          />

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Riwayat Retur ({returnList.length})
              </p>
              <p className="text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                Total kembali {formatRupiah(returnsSummary.refundTotal)}
              </p>
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {returnList.map((ret) => (
                <div key={ret.id} className="p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      {ret.receipt_no}
                    </p>
                    <p className="font-mono tabular-nums text-lco-mustard font-semibold">
                      {formatRupiah(ret.refund_amount)}
                    </p>
                  </div>
                  <p className="text-zinc-400 font-mono tabular-nums">
                    {formatDate(ret.created_at)}
                    {ret.cashier_name ? ` · ${ret.cashier_name}` : ""}
                  </p>
                  <ul className="text-zinc-700 dark:text-zinc-300">
                    {ret.items.map((item) => (
                      <li key={item.id}>
                        {item.product_name}{" "}
                        <span className="font-mono tabular-nums text-zinc-500">
                          × {item.qty}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {ret.payments.length > 0 && (
                    <p className="text-zinc-500">
                      {ret.payments
                        .map(
                          (pay) =>
                            `${methodLabel(pay.method)} ${formatRupiah(Math.abs(pay.amount))}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                  {ret.reason && (
                    <p className="text-zinc-500">Alasan: {ret.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
