"use client";

// Pilih cabang tempat satu kategori tersedia. Hanya dibuka dari outlet pusat:
// kategori buatan pusat tampil di cabang setelah ditambahkan di sini.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import type { Branch } from "@/lib/pos/branches";
import type { Category } from "@/lib/pos/types";
import type { CategoryBranchRow } from "@/lib/pos/categoryBranch";
import { fetchCategoryBranchRows, setCategoryBranch } from "@/lib/pos/categoryBranchApi";

interface Props {
  category: Pick<Category, "id" | "name">;
  /** Cabang aktif yang boleh dipilih (lihat productTargetBranches). */
  branches: Branch[];
  canEdit: boolean;
  onClose: () => void;
}

export default function CategoryBranchesModal({ category, branches, canEdit, onClose }: Props) {
  const [rows, setRows] = useState<CategoryBranchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchCategoryBranchRows(category.id);
    setError(result.error);
    setRows(result.rows);
    setIsLoading(false);
  }, [category.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pola fetch-on-mount yang sama dengan hook lain di app ini
    void load();
  }, [load]);

  async function toggle(branchId: string, listed: boolean) {
    setBusyBranch(branchId);
    setError(null);
    const result = await setCategoryBranch({ categoryId: category.id, branchId, listed });
    setBusyBranch(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <Modal size="md" padding="none" layout="flex" aria-label={`Tambahkan kategori ${category.name} di cabang`}>
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <ModalHeader title="Tambahkan di Cabang" onClose={onClose} />
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {category.name} · kategori hanya tampil di cabang yang Anda tambahkan di sini.
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {error && (
          <div className="flex items-start gap-2 border border-lco-coral/30 p-3 text-xs text-lco-coral">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat cabang...
          </div>
        ) : branches.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            Belum ada cabang aktif. Tambahkan cabang di Pengaturan &gt; Outlet.
          </p>
        ) : (
          branches.map((branch) => {
            const listed = rows.some((r) => r.branch_id === branch.id);
            const busy = busyBranch === branch.id;

            return (
              <div
                key={branch.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{branch.name}</p>
                  <p
                    className={`text-xs ${
                      listed ? "text-lco-green dark:text-lco-teal" : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {listed ? "Sudah ditambahkan" : "Belum ditambahkan"}
                  </p>
                </div>

                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant={listed ? "outline-danger" : "secondary"}
                    disabled={busy}
                    onClick={() => toggle(branch.id, !listed)}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {listed ? "Lepas dari cabang" : "Tambahkan di cabang ini"}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex justify-end border-t border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Button type="button" variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      </div>
    </Modal>
  );
}
