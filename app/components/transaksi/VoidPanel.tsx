"use client";

// app/components/transaksi/VoidPanel.tsx
// ── Dipecah dari TransactionDetailModal.tsx — panel form void transaksi.
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import { Loader2 } from "lucide-react";
import Button from "@/app/components/ui/Button";

export default function VoidPanel({
  voidReason,
  onReasonChange,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  voidReason: string;
  onReasonChange: (value: string) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-lco-coral/40 bg-lco-coral/10 p-4">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Alasan Void
      </label>
      <textarea
        value={voidReason}
        onChange={(e) => onReasonChange(e.target.value)}
        rows={2}
        placeholder="Contoh: salah input, transaksi ganda, dll."
        className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal"
      />
      <p className="text-[11px] text-lco-coral">
        Seluruh item pada transaksi ini akan dibatalkan dan stok yang belum
        diretur akan dikembalikan.
      </p>
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
          variant="danger"
          size="sm"
          className="flex-1"
        >
          {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Ya, Void Transaksi
        </Button>
      </div>
    </div>
  );
}
