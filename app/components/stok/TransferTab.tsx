"use client";

// Tab "Transfer": riwayat pindah stok yang melibatkan outlet aktif dan tombol buat transfer baru.

import { useState } from "react";
import { AlertTriangle, ArrowRight, Inbox, Loader2, Plus } from "lucide-react";
import { useStockTransfers } from "@/hooks/useStockTransfers";
import { useActiveBranch } from "@/hooks/useActiveBranch";
import { branchName } from "@/lib/pos/branches";
import type { ProductWithCategory } from "@/hooks/useProducts";
import TransferForm from "./TransferForm";
import { formatDateTime, formatNumber } from "./stokUtils";
import Button from "@/app/components/ui/Button";

interface Props {
  products: ProductWithCategory[];
  canEdit: boolean;
  onStockChanged: () => void;
}

export default function TransferTab({ products, canEdit, onStockChanged }: Props) {
  const { transfers, isLoading, error, refetch } = useStockTransfers();
  const { activeBranch, branches } = useActiveBranch();
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!activeBranch) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
        Transfer stok butuh minimal satu outlet aktif.
      </p>
    );
  }

  if (showForm) {
    return (
      <TransferForm
        products={products}
        fromBranch={activeBranch}
        branches={branches}
        onBack={() => setShowForm(false)}
        onSaved={() => {
          setShowForm(false);
          refetch();
          onStockChanged();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-zinc-500">
          Pindahkan stok dari {activeBranch.name} ke outlet lain. Total stok semua outlet tidak berubah.
        </p>

        {canEdit && branches.filter((b) => b.is_active).length > 1 && (
          <Button type="button" size="lg" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Transfer Stok
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat transfer...
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-sm text-lco-coral">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Belum ada transfer untuk outlet ini.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {transfers.map((t) => {
              const outgoing = t.from_branch_id === activeBranch.id;
              const open = expanded === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : t.id)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <span className="font-medium">#{t.number}</span>
                    <span className="flex items-center gap-1.5 text-sm">
                      {branchName(branches, t.from_branch_id)}
                      <ArrowRight className="h-3.5 w-3.5 text-zinc-400" />
                      {branchName(branches, t.to_branch_id)}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        outgoing ? "text-lco-coral" : "text-lco-green dark:text-lco-teal"
                      }`}
                    >
                      {outgoing ? "Keluar" : "Masuk"}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">
                      {formatNumber(t.item_count)} produk · {formatNumber(t.total_qty)} unit ·{" "}
                      {formatDateTime(t.created_at)}
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-900 dark:bg-zinc-900/30">
                      {t.created_by_name && <p className="text-xs text-zinc-500">Oleh {t.created_by_name}</p>}
                      {t.note && <p className="mt-1 text-xs text-zinc-500">Catatan: {t.note}</p>}
                      <ul className="mt-2 space-y-1">
                        {t.items.map((item) => (
                          <li key={item.id} className="flex justify-between gap-3">
                            <span>
                              {item.product_name}
                              {item.product_sku && (
                                <span className="ml-2 font-mono text-xs text-zinc-400">{item.product_sku}</span>
                              )}
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatNumber(item.qty)} {item.product_unit ?? ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
