"use client";

// app/components/transaksi/DetailInfoSection.tsx
// ── Dipecah dari TransactionDetailModal.tsx — tanggal, kasir, pelanggan, dan alasan void/retur.
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { Phone, StickyNote, User } from "lucide-react";
import type { TransactionDetail } from "@/lib/pos/transactionApi";
import { formatDate } from "./transactionDetailUtils";

export default function DetailInfoSection({
  detail,
  isReturnRow,
}: {
  detail: TransactionDetail;
  isReturnRow: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1">
            Tanggal
          </p>
          <p className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatDate(detail.created_at)}
          </p>
        </div>
        <div>
          <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1">
            Kasir
          </p>
          <p className="text-zinc-900 dark:text-zinc-100">
            {detail.cashier_name ?? "-"}
          </p>
        </div>
        {detail.customer_name && (
          <div>
            <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1 flex items-center gap-1">
              <User className="w-3 h-3" /> Pelanggan
            </p>
            <p className="text-zinc-900 dark:text-zinc-100">
              {detail.customer_name}
            </p>
          </div>
        )}
        {detail.customer_phone && (
          <div>
            <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1 flex items-center gap-1">
              <Phone className="w-3 h-3" /> No. HP
            </p>
            <p className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
              {detail.customer_phone}
            </p>
          </div>
        )}
        {isReturnRow && detail.original_receipt_no && (
          <div className="col-span-2">
            <p className="text-zinc-400 uppercase tracking-wider text-[10px] font-semibold mb-1">
              Retur dari struk
            </p>
            <p className="font-mono text-zinc-900 dark:text-zinc-100">
              {detail.original_receipt_no}
            </p>
          </div>
        )}
      </div>

      {detail.void_reason && (
        <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
          <StickyNote className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              {detail.status === "VOID" ? "Alasan void" : "Alasan retur"}
            </p>
            <p>{detail.void_reason}</p>
          </div>
        </div>
      )}
    </>
  );
}
