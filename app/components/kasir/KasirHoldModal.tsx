"use client";

// app/components/kasir/KasirHoldModal.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Modal konfirmasi "Tunda" (T-11 bagian 1): isi catatan opsional lalu
// keranjang dikosongkan dan bisa dilanjutkan lewat daftar pesanan tertunda.

import { Loader2 } from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";

interface KasirHoldModalProps {
  itemCount: number;
  subtotal: number;
  label: string;
  onLabelChange: (value: string) => void;
  isHolding: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function KasirHoldModal({
  itemCount,
  subtotal,
  label: holdLabel,
  onLabelChange,
  isHolding,
  error: holdModalError,
  onCancel,
  onConfirm,
}: KasirHoldModalProps) {
  return (
    <Modal size="sm" padding="md" layout="plain">
      <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Tunda Transaksi
      </h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        {itemCount} item, {formatRupiah(subtotal)} — keranjang
        akan dikosongkan dan bisa dilanjutkan lagi lewat ikon riwayat di
        atas keranjang.
      </p>

      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Catatan (opsional)
      </label>
      <input
        type="text"
        value={holdLabel}
        onChange={(e) => onLabelChange(e.target.value)}
        disabled={isHolding}
        placeholder="Mis. nama pelanggan"
        className="mb-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-1 focus:ring-lco-teal disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
      />

      {holdModalError && (
        <p className="mb-3 text-xs text-lco-coral">{holdModalError}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          onClick={onCancel}
          disabled={isHolding}
          variant="secondary"
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isHolding}
        >
          {isHolding && <Loader2 className="h-4 w-4 animate-spin" />}
          Tunda
        </Button>
      </div>
    </Modal>
  );
}
