"use client";

// ── TAMBAHAN (menu Pelanggan) ── Form daftar / ubah pelanggan, sengaja
// SEDERHANA seperti pendaftaran member minimarket: cukup no. HP (wajib),
// nama opsional. Validasi format ada di toPayload() hooks/useCustomerAdmin.ts.
// No. HP yang sudah terdaftar DITOLAK di sini (no. HP = identitas member,
// dan dipakai mengaitkan riwayat transaksi).

import { useMemo, useState } from "react";
import { Loader2, X, AlertTriangle } from "lucide-react";
import {
  isNamelessCustomer,
  normalizePhone,
  type CustomerFormValues,
  type CustomerRecord,
} from "@/hooks/useCustomerAdmin";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import IconButton from "@/app/components/ui/IconButton";
import Modal from "@/app/components/ui/Modal";

interface PelangganFormModalProps {
  /** null = mode tambah, ada isi = mode ubah. */
  customer: CustomerRecord | null;
  /** Dipakai cek no. HP kembar. */
  existing: CustomerRecord[];
  onClose: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
}


export default function PelangganFormModal({
  customer,
  existing,
  onClose,
  onSubmit,
}: PelangganFormModalProps) {
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [name, setName] = useState(
    customer && !isNamelessCustomer(customer) ? customer.name : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const duplicate = useMemo(() => {
    const key = normalizePhone(phone);
    if (key.length < 9) return null;
    return (
      existing.find(
        (c) => c.id !== customer?.id && normalizePhone(c.phone) === key,
      ) ?? null
    );
  }, [phone, existing, customer?.id]);

  async function handleSubmit() {
    setError("");
    if (duplicate) {
      setError("No. HP ini sudah terdaftar.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ phone, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      setSaving(false);
    }
  }

  return (
    <Modal size="sm" placement="sheet" padding="none" layout="plain">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
          {customer ? "Ubah Pelanggan" : "Daftarkan Pelanggan"}
        </h3>
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
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            No. HP / WhatsApp <span className="text-lco-coral">*</span>
          </label>
          <Input
            size="lg"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !saving && handleSubmit()}
            placeholder="08xxxxxxxxxx"
            autoFocus
          />
        </div>

        {duplicate && (
          <div className="flex items-start gap-2 rounded-md bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No. HP ini sudah terdaftar
              {isNamelessCustomer(duplicate) ? (
                "."
              ) : (
                <>
                  {" "}
                  atas nama <strong>{duplicate.name}</strong>.
                </>
              )}
            </span>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Nama <span className="font-normal text-zinc-400">(opsional)</span>
          </label>
          <Input
            size="lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !saving && handleSubmit()}
            placeholder="Boleh dikosongkan"
          />
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
          disabled={saving || !!duplicate}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {customer ? "Simpan" : "Daftarkan"}
        </Button>
      </div>
    </Modal>
  );
}
