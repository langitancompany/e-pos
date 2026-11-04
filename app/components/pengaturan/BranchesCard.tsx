"use client";

// app/components/pengaturan/BranchesCard.tsx
// ── BARU (migration 047, multi cabang) ── Card "Cabang / Toko" di Pengaturan >
// Toko & Struk: daftar toko yang ada + tambah/ubah/nonaktifkan cabang.
// Cabang tidak bisa dihapus (transaksi merujuk ke sana) — cukup dinonaktifkan.
// Izin: tambah = pengaturan_toko.create, ubah/nonaktifkan = pengaturan_toko.edit
// (juga ditegakkan RLS tabel `branches`).

import { useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
} from "lucide-react";
import { hasPermissionAction, useAuth } from "@/hooks/useAuth";
import { useBranches, type BranchInput } from "@/hooks/useBranches";
import { useActiveBranch } from "@/hooks/useActiveBranch";
import type { Branch } from "@/lib/pos/branches";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Textarea from "@/app/components/ui/Textarea";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";

const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

function BranchFormModal({
  branch,
  onClose,
  onSubmit,
}: {
  /** null = tambah cabang baru. */
  branch: Branch | null;
  onClose: () => void;
  onSubmit: (input: BranchInput) => Promise<void>;
}) {
  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState(branch?.code ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name, code, address, phone });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan cabang.");
      setSaving(false);
    }
  }

  return (
    <Modal size="md" aria-label={branch ? "Ubah cabang" : "Tambah cabang"}>
      <ModalHeader
        title={branch ? "Ubah Cabang" : "Tambah Cabang"}
        icon={<Building2 className="h-4 w-4 text-lco-green dark:text-lco-teal" />}
        onClose={onClose}
        closeDisabled={saving}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div>
            <label className={labelClass} htmlFor="branch-name">
              Nama Cabang <span className="text-lco-coral">*</span>
            </label>
            <Input
              id="branch-name"
              size="lg"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Cabang Pusat"
              autoFocus
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="branch-code">
              Kode
            </label>
            <Input
              id="branch-code"
              size="lg"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="mis. PST"
              maxLength={12}
            />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="branch-address">
            Alamat
          </label>
          <Textarea
            id="branch-address"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Tercetak di struk cabang ini"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="branch-phone">
            Telepon
          </label>
          <Input
            id="branch-phone"
            size="lg"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Tercetak di struk cabang ini"
          />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Nama, alamat, dan telepon cabang dipakai di judul kasir & struk saat cabang ini dipilih.
          Kosongkan alamat/telepon untuk memakai data Identitas Toko di bawah.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" disabled={saving || name.trim().length < 2}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function BranchesCard() {
  const { user } = useAuth();
  const { branches, isLoading, error, addBranch, updateBranch, setBranchActive } = useBranches();
  const { activeBranchId, setActiveBranch } = useActiveBranch();

  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canCreate = hasPermissionAction(user, "pengaturan_toko", "create");
  const canEdit = hasPermissionAction(user, "pengaturan_toko", "edit");

  async function handleToggle(b: Branch) {
    setBusyId(b.id);
    setActionError(null);
    try {
      await setBranchActive(b.id, !b.is_active);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah status cabang.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lco-green/10 text-lco-green dark:text-lco-teal">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cabang / Toko</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Daftar toko yang memakai aplikasi ini. Pilih cabang aktif lewat tombol di kiri Buka Kasir.
            </p>
          </div>
        </div>
        {canCreate && (
          <Button type="button" size="sm" className="shrink-0" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> Tambah Cabang
          </Button>
        )}
      </div>

      <div className="p-4">
        {(error || actionError) && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {actionError ??
              `Gagal memuat cabang: ${error}. Pastikan migration 047_multi_branch.sql sudah dijalankan.`}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat cabang...
          </div>
        ) : branches.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">Belum ada cabang.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {branches.map((b) => {
              const isCurrent = b.id === activeBranchId;
              return (
                <li
                  key={b.id}
                  className={`flex flex-col rounded-lg border p-4 ${
                    isCurrent
                      ? "border-lco-green/50 bg-lco-green/5 dark:border-lco-teal/50 dark:bg-lco-teal/5"
                      : "border-zinc-200 dark:border-zinc-800"
                  } ${b.is_active ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {b.name}
                      </p>
                      {b.code && (
                        <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                          {b.code}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isCurrent && (
                        <span className="rounded-full bg-lco-green px-2 py-0.5 text-[10px] font-semibold text-white">
                          Dipakai sekarang
                        </span>
                      )}
                      {!b.is_active && (
                        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          Nonaktif
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <p className="flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{b.address || <em className="text-zinc-400">alamat belum diisi</em>}</span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span>{b.phone || <em className="text-zinc-400">telepon belum diisi</em>}</span>
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 pt-1">
                    {b.is_active && !isCurrent && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setActiveBranch(b.id)}
                      >
                        <Check className="h-3.5 w-3.5" /> Pakai
                      </Button>
                    )}
                    {canEdit && (
                      <>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(b)}>
                          <Pencil className="h-3.5 w-3.5" /> Ubah
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busyId === b.id}
                          onClick={() => handleToggle(b)}
                        >
                          {busyId === b.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Power className="h-3.5 w-3.5" />
                          )}
                          {b.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <BranchFormModal
          branch={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(input) =>
            editing === "new" ? addBranch(input) : updateBranch(editing.id, input)
          }
        />
      )}
    </div>
  );
}
