"use client";

// app/components/transaksi/DetailItemsTable.tsx
// ── Dipecah dari TransactionDetailModal.tsx — tabel item transaksi (+ kolom qty retur saat mode retur).
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { formatRupiah } from "@/lib/pos/cartLogic";
import type { TransactionDetail } from "@/lib/pos/transactionApi";
import type { PanelMode } from "./transactionDetailUtils";

const remainingQty = (itemId: string, qty: number, returned: number) =>
  qty - returned;

export default function DetailItemsTable({
  detail,
  mode,
  returnQtyById,
  onReturnQtyChange,
}: {
  detail: TransactionDetail;
  mode: PanelMode;
  returnQtyById: Record<string, number>;
  onReturnQtyChange: (itemId: string, qty: number) => void;
}) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
          <tr>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
              Produk
            </th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
              Qty
            </th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
              Subtotal
            </th>
            {mode === "retur" && (
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-zinc-500 text-[10px]">
                Retur
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {detail.items.map((item) => {
            const sisa = remainingQty(item.id, item.qty, item.returned_qty);
            return (
              <tr key={item.id}>
                <td className="px-3 py-2">
                  <p className="text-zinc-900 dark:text-zinc-100">
                    {item.product_name}
                  </p>
                  {item.returned_qty > 0 && (
                    <p className="text-[10px] text-lco-mustard font-mono tabular-nums">
                      {item.returned_qty} sudah diretur
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                  {item.qty}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatRupiah(item.subtotal)}
                </td>
                {mode === "retur" && (
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={sisa}
                      disabled={sisa <= 0}
                      value={returnQtyById[item.id] ?? 0}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const clamped = Math.max(
                          0,
                          Math.min(sisa, isNaN(raw) ? 0 : raw),
                        );
                        onReturnQtyChange(item.id, clamped);
                      }}
                      className="w-16 px-2 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md text-right font-mono tabular-nums text-xs focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal disabled:opacity-40"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
