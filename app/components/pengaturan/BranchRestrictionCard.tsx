"use client";

// app/components/pengaturan/BranchRestrictionCard.tsx
// ── BARU (migration 047, multi cabang) ── Card "Batasan Cabang" di detail
// pengguna (Pengaturan > Pengguna), di BAWAH kartu Informasi Pengguna —
// terpisah dari matriks Hak Akses Modul.
//
// Aturan:
//   - Daftar KOSONG = tanpa batasan -> pengguna bisa mengakses SEMUA cabang.
//   - Ada isi    = pengguna hanya bisa mengakses cabang yang tercantum.
//   - Super Admin selalu bisa semua cabang (kartu hanya informasi).
// Tiap tambah/hapus langsung tersimpan (tidak ikut tombol "Simpan Perubahan"
// hak akses). Penegakan sebenarnya ada di database (RLS can_access_branch) dan
// di PATCH /api/admin/update-user — kartu ini hanya antarmuka.

import { useMemo, useState } from "react";
import { AlertCircle, Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { useBranches } from "@/hooks/useBranches";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import Select from "@/app/components/ui/Select";

interface Props {
  branchIds: string[];
  /** Super Admin: selalu semua cabang, tidak bisa dibatasi. */
  superAdmin: boolean;
  canEdit: boolean;
  /** Alasan tombol dinonaktifkan (ditampilkan sebagai tooltip/keterangan). */
  readOnlyReason?: string;
  /** Simpan daftar baru. Lempar Error bila ditolak server. */
  onSave: (branchIds: string[]) => Promise<void>;
}

export default function BranchRestrictionCard({
  branchIds,
  superAdmin,
  canEdit,
  readOnlyReason,
  onSave,
}: Props) {
  const { branches, isLoading } = useBranches();
  const [addOpen, setAddOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? "Cabang tidak dikenal";

  const candidates = useMemo(
    () => branches.filter((b) => b.is_active && !branchIds.includes(b.id)),
    [branches, branchIds],
  );

  const run = async (next: string[], after: () => void) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      after();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan batasan cabang.");
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setPick(candidates[0]?.id ?? "");
    setError(null);
    setAddOpen(true);
  };

  const closeAdd = () => {
    if (saving) return;
    setAddOpen(false);
    setError(null);
  };

  const removingLast = removeId !== null && branchIds.length === 1;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lco-green/10 text-lco-green dark:text-lco-teal">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Batasan Cabang</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Akses cabang yang diperbolehkan</p>
          </div>
        </div>
        {!superAdmin && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={!canEdit || candidates.length === 0}
            title={
              !canEdit
                ? readOnlyReason
                : candidates.length === 0
                  ? "Semua cabang sudah ada di daftar"
                  : undefined
            }
            onClick={openAdd}
          >
            <Plus className="h-3.5 w-3.5" /> Tambah Batasan
          </Button>
        )}
      </div>

      <div className="p-5">
        {superAdmin ? (
          <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-5 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Super Admin selalu dapat mengakses semua cabang.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-[1fr_auto] gap-3 bg-zinc-50 px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <span>Cabang</span>
              <span className="w-12 text-center">Aksi</span>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-5 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
              </div>
            ) : branchIds.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Tanpa batasan — pengguna ini dapat mengakses <strong>semua cabang</strong>.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {branchIds.map((id) => (
                  <li key={id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5">
                    <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {nameOf(id)}
                    </span>
                    <span className="flex w-12 justify-center">
                      <IconButton
                        aria-label={`Hapus batasan ${nameOf(id)}`}
                        tone="danger"
                        variant="outlined"
                        disabled={!canEdit}
                        title={!canEdit ? readOnlyReason : undefined}
                        onClick={() => {
                          setError(null);
                          setRemoveId(id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!superAdmin && !addOpen && removeId === null && error && (
          <p className="mt-3 flex items-start gap-2 text-xs text-lco-coral">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>

      {addOpen && (
        <Modal size="sm" aria-label="Tambah batasan cabang">
          <ModalHeader
            title="Tambah Batasan Cabang"
            icon={<Building2 className="h-4 w-4 text-lco-green dark:text-lco-teal" />}
            onClose={closeAdd}
            closeDisabled={saving}
          />
          <div className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            <div>
              <label htmlFor="branch-pick" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Pilih Cabang <span className="text-lco-coral">*</span>
              </label>
              <Select
                id="branch-pick"
                size="lg"
                fullWidth
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                {candidates.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            {branchIds.length === 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Saat ini pengguna dapat mengakses semua cabang. Setelah batasan pertama ditambahkan,
                pengguna <strong>hanya</strong> dapat mengakses cabang yang tercantum di daftar.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeAdd} disabled={saving}>
                Batal
              </Button>
              <Button
                type="button"
                disabled={saving || !pick}
                onClick={() => run([...branchIds, pick], () => setAddOpen(false))}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Menyimpan..." : "Tambah"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {removeId !== null && (
        <Modal size="sm" aria-label="Hapus batasan cabang">
          <ModalHeader
            title="Hapus Batasan Cabang"
            icon={<Trash2 className="h-4 w-4 text-lco-coral" />}
            onClose={() => !saving && setRemoveId(null)}
            closeDisabled={saving}
          />
          <div className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Hapus <strong>{nameOf(removeId)}</strong> dari batasan cabang pengguna ini?
            </p>
            {removingLast && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Ini batasan terakhir. Setelah dihapus, pengguna dapat mengakses <strong>semua cabang</strong>.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRemoveId(null)} disabled={saving}>
                Batal
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={saving}
                onClick={() => run(branchIds.filter((x) => x !== removeId), () => setRemoveId(null))}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Menghapus..." : "Hapus"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
