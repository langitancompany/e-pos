"use client";

// app/components/laporan/ReturnsTab.tsx
// ── TAMBAHAN (Laporan, adopsi ide dari tab "Retur & Garansi" Kula POS) ──
// Tab "Retur": daftar retur dalam rentang tanggal + total refund. Data dari
// hooks/useReturnsReport.ts.
//
// Fitur garansi TIDAK ada di database ePOS, jadi tab ini hanya "Retur"
// (bukan "Retur & Garansi"). Jumlah item per retur dan metode refund juga
// tidak disimpan per retur, jadi tidak ditampilkan.

import {
  AlertTriangle,
  Inbox,
  Loader2,
  Receipt,
  RotateCcw,
} from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import type { UseReturnsReportResult } from "@/hooks/useReturnsReport";

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const thClass =
  "px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormatter.format(date);
}

export function ReturnsTab({ returns }: { returns: UseReturnsReportResult }) {
  const { data, isLoading, error } = returns;

  if (isLoading || (!data && !error)) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat laporan retur...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Laporan retur tidak dapat dimuat{error ? `: ${error}` : "."}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <RotateCcw className="h-3.5 w-3.5" />
            Jumlah Retur
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {data.count}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <Receipt className="h-3.5 w-3.5" />
            Total Refund
          </p>
          <p
            className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
              data.totalRefund > 0 ? "text-lco-coral" : ""
            }`}
          >
            {formatRupiah(data.totalRefund)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        {data.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-xs text-zinc-500">
            <Inbox className="h-5 w-5 text-zinc-400" />
            Tidak ada retur pada rentang ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th className={thClass}>Waktu</th>
                  <th className={thClass}>No. Retur</th>
                  <th className={thClass}>Struk Asal</th>
                  <th className={thClass}>Kasir</th>
                  <th className={thClass}>Alasan</th>
                  <th className={`${thClass} text-right`}>Refund</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs">
                      {row.receiptNo}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs">
                      {row.originalReceiptNo ?? "-"}
                    </td>
                    <td className="px-5 py-2.5 text-xs">
                      {row.cashierName ?? "-"}
                    </td>
                    <td className="max-w-[16rem] px-5 py-2.5 text-xs">
                      <span className="line-clamp-2 break-words">
                        {row.reason ?? "-"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums text-lco-coral">
                      {formatRupiah(row.refund)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Alasan diisi kasir saat memproses retur. Retur parsial tercatat per
        transaksi retur.
      </p>
    </div>
  );
}
