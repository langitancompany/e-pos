"use client";

// ── TAMBAHAN (menu Pelanggan) ── Penyesuaian poin manual (tambah/kurangi).
// Alasan WAJIB (jadi jejak audit di customer_point_logs + activity_logs).
// Validasi akhir (saldo tidak boleh negatif) ada di RPC adjust_customer_points.

import { useState } from "react";
import { Loader2, Minus, Plus, X } from "lucide-react";
import type { CustomerRecord } from "@/hooks/useCustomerAdmin";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import Chip from "@/app/components/ui/Chip";
import Input from "@/app/components/ui/Input";
import Modal from "@/app/components/ui/Modal";

interface PoinAdjustModalProps {
  customer: CustomerRecord;
  /** Nilai 1 poin dalam rupiah (sama dengan LOYALTY_POINT_VALUE di Kasir). */
  pointValue: number;
  onClose: () => void;
  onSubmit: (delta: number, reason: string) => Promise<void>;
}

const REASON_PRESETS = [
  "Bonus loyalitas",
  "Kompensasi / komplain",
  "Koreksi kesalahan input",
  "Poin kedaluwarsa",
];

export default function PoinAdjustModal({
  customer,
  pointValue,
  onClose,
  onSubmit,
}: PoinAdjustModalProps) {
  const [mode, setMode] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsed = Math.floor(Number(amount));
  const validAmount = Number.isFinite(parsed) && parsed > 0;
  const delta = validAmount ? (mode === "add" ? parsed : -parsed) : 0;
  const after = customer.loyalty_points + delta;

  async function handleSubmit() {
    setError("");
    if (!validAmount) {
      setError("Masukkan jumlah poin lebih dari 0.");
      return;
    }
    if (after < 0) {
      setError("Poin tidak cukup untuk dikurangi sebanyak itu.");
      return;
    }
    if (!reason.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(delta, reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      setSaving(false);
    }
  }

  return (
    <Modal size="md" placement="sheet" padding="none" layout="plain">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Sesuaikan Poin
          </h3>
          <p className="text-xs text-zinc-500">{customer.name}</p>
        </div>
        <IconButton
          type="button"
          onClick={() => !saving && onClose()}
          variant="soft"
          size="sm"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Chip
            type="button"
            onClick={() => setMode("add")}
            selected={mode === "add"}
            size="lg"
          >
            <Plus className="h-4 w-4" /> Tambah
          </Chip>
          <Chip
            type="button"
            onClick={() => setMode("subtract")}
            selected={mode === "subtract"}
            tone="danger"
            size="lg"
          >
            <Minus className="h-4 w-4" /> Kurangi
          </Chip>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Jumlah poin
          </label>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            autoFocus
          />
          <p className="mt-1 text-xs text-zinc-500">
            Saldo sekarang <strong>{customer.loyalty_points}</strong> poin
            {validAmount && (
              <>
                {" "}
                → <strong>{Math.max(after, 0)}</strong> poin (setara Rp{" "}
                {(Math.max(after, 0) * pointValue).toLocaleString("id-ID")})
              </>
            )}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Alasan <span className="text-lco-coral">*</span>
          </label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Mengapa poin diubah?"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:border-lco-teal hover:text-lco-green dark:border-zinc-700 dark:text-zinc-400"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <Button
          type="button"
          onClick={onClose}
          disabled={saving}
          variant="ghost"
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Simpan
        </Button>
      </div>
    </Modal>
  );
}
