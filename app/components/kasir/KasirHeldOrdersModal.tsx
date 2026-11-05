"use client";

// app/components/kasir/KasirHeldOrdersModal.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Modal daftar pesanan tertunda (T-11 bagian 1): lanjutkan atau hapus.

import { Loader2, PlayCircle, Trash2, X } from "lucide-react";
import type { HeldOrder } from "@/hooks/useHoldOrders";
import { formatRupiah } from "@/lib/pos/cartLogic";
import Modal from "@/app/components/ui/Modal";
import IconButton from "@/app/components/ui/IconButton";

interface KasirHeldOrdersModalProps {
  heldOrders: HeldOrder[];
  isLoading: boolean;
  /** Error lanjutkan/hapus (merah, di atas daftar). */
  heldListError: string | null;
  /** ID pesanan yang sedang diproses (tombolnya dikunci / spinner). */
  resumingId: string | null;
  onClose: () => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function KasirHeldOrdersModal({
  heldOrders,
  isLoading,
  heldListError,
  resumingId,
  onClose,
  onResume,
  onDelete,
}: KasirHeldOrdersModalProps) {
  return (
    <Modal size="md" padding="none" layout="flex">
      <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Pesanan Tertunda
        </h3>
        <IconButton
          onClick={onClose}
          aria-label="Tutup"
          size="sm"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      {heldListError && (
        <p className="mx-4 mt-3 text-xs text-lco-coral">{heldListError}</p>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : heldOrders.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-400">
            Belum ada pesanan yang ditunda.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {heldOrders.map((ho) => (
              <div
                key={ho.id}
                className="flex items-center gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {ho.label || "Tanpa catatan"}
                  </p>
                  <p className="font-mono text-xs text-zinc-500">
                    {ho.item_count} item • {formatRupiah(ho.subtotal)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Lanjutkan pesanan"
                  onClick={() => onResume(ho.id)}
                  disabled={resumingId === ho.id}
                  title="Lanjutkan"
                  className="rounded-md p-2 text-lco-teal hover:bg-lco-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resumingId === ho.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                </button>
                <IconButton
                  onClick={() => onDelete(ho.id)}
                  disabled={resumingId === ho.id}
                  title="Hapus"
                  aria-label="Hapus"
                  variant="soft"
                  tone="danger"
                  size="lg"
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
