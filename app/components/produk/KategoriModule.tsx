"use client";

// ── KOREKSI ── Diselaraskan dengan THEME-GUIDE LCO POS (Tailwind 4):
// - Warna generic (emerald/teal/red) diganti ke token lco-green / lco-teal / lco-coral.
// - Status "Aktif/Nonaktif" jadi indikator teks berwarna, bukan badge kotak solid (PRD §8).
// - Radius: rounded-md untuk tombol/input, rounded-xl untuk panel/modal (PRD §8).
// - Tambah dark mode (bg-zinc-950/900, border-zinc-800) agar konsisten dengan ProdukModule.tsx.
// - Tipe Category dipakai dari lib/pos/types.ts (satu sumber kebenaran, sama seperti useCategories hook).
// - Akses Supabase langsung (createClient + supabase.from("categories")) DIHAPUS: baca & tulis
//   sekarang lewat useCategories({ includeInactive: true }). Validasi form ada di lib/pos/categoryLogic.ts.

import { useState } from "react";
import { Loader2, Pencil, Plus, Store, Trash2, X } from "lucide-react";
import { useCategories } from "@/hooks/useCategories";
import { useActiveBranch } from "@/hooks/useActiveBranch";
import { useAuth, hasPermissionAction } from "@/hooks/useAuth";
import { outletRole, productTargetBranches } from "@/lib/pos/branches";
import CategoryBranchesModal from "./CategoryBranchesModal";
import { validateCategoryInput } from "@/lib/pos/categoryLogic";
import type { Category } from "@/lib/pos/types";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import Input from "@/app/components/ui/Input";
import { useToast } from "@/app/components/ui/useToast";

type CategoryForm = {
  name: string;
  sort_order: string;
  is_active: boolean;
};

const DEFAULT_FORM: CategoryForm = {
  name: "",
  sort_order: "0",
  is_active: true,
};

export default function KategoriModule() {
  // Layar admin wajib menampilkan kategori nonaktif juga (agar bisa diaktifkan kembali),
  // maka includeInactive: true. Chip Kasir & form Produk tetap memakai default (hanya aktif).
  const {
    categories,
    isLoading: loading,
    error: loadError,
    createCategory,
    updateCategory,
    deleteCategory,
    setCategoryActive,
  } = useCategories({ includeInactive: true });

  const { user } = useAuth();
  const { activeBranch, branches } = useActiveBranch();
  const role = outletRole(activeBranch);
  const canEditProduct = hasPermissionAction(user, "produk", "edit");
  const [branchCategory, setBranchCategory] = useState<Category | null>(null);

  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<CategoryForm>(DEFAULT_FORM);
  const [actionError, setActionError] = useState("");
  const { notify, toastElement } = useToast();

  // Error tampil = error aksi terakhir, atau error gagal-muat dari hook bila tidak ada aksi.
  const error = actionError || loadError || "";
  const setError = setActionError;

  function openCreateForm() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError("");
    setShowForm(true);
  }

  function openEditForm(category: Category) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      sort_order: String(category.sort_order ?? 0),
      is_active: category.is_active,
    });
    setError("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError("");
  }

  async function handleSave() {
    setError("");

    const parsed = validateCategoryInput(form);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    setSaving(true);

    const wasEditing = editingId !== null;
    const result = editingId
      ? await updateCategory(editingId, parsed.value)
      : await createCategory(parsed.value);

    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    notify(
      wasEditing
        ? "Kategori berhasil diperbarui."
        : "Kategori berhasil ditambahkan.",
    );
  }

  async function handleDelete(category: Category) {
    setError("");

    const confirmed = window.confirm(
      `Hapus kategori "${category.name}"?\n\nJika kategori sudah digunakan oleh produk, penghapusan mungkin gagal.`,
    );

    if (!confirmed) return;

    const result = await deleteCategory(category.id);

    if (result.error) {
      setError(result.error);
      return;
    }

    notify("Kategori berhasil dihapus.");
  }

  async function toggleActive(category: Category) {
    setError("");

    const result = await setCategoryActive(category.id, !category.is_active);

    if (result.error) {
      setError(result.error);
    }
  }

  return (
    <div className="space-y-6">
      {toastElement}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Master Data
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Kategori Produk
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Kelola kategori yang digunakan pada produk.
            {role === "cabang" && " Kategori yang Anda buat di sini hanya tersedia di cabang ini dan tidak muncul di pusat."}
            {role === "pusat" && " Kategori buatan pusat hanya tampil di pusat sampai ditambahkan ke cabang."}
          </p>
        </div>

        <Button type="button" onClick={openCreateForm} size="lg">
          <Plus size={18} />
          Tambah Kategori
        </Button>
      </div>

      {error && !showForm && (
        <div className="rounded-md border border-lco-coral/30 bg-lco-coral/10 px-4 py-3 text-sm text-lco-coral">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
            Memuat kategori...
          </div>
        ) : categories.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Belum ada kategori
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Tambahkan kategori pertama untuk mulai mengelompokkan produk.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Kategori
                  </th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Urutan
                  </th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Status
                  </th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Aksi
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {categories.map((category) => (
                  <tr
                    key={category.id}
                    className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <td className="px-5 py-4">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {category.name}
                      </span>
                    </td>

                    <td className="px-5 py-4 font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                      {category.sort_order}
                    </td>

                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => toggleActive(category)}
                        className={`text-sm font-medium transition-colors duration-150 ${
                          category.is_active
                            ? "text-lco-green hover:text-lco-green-hover dark:text-lco-teal"
                            : "text-zinc-400 hover:text-zinc-600"
                        }`}
                      >
                        {category.is_active ? "Aktif" : "Nonaktif"}
                      </button>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1">
                        {role === "pusat" && (
                          <Button
                            type="button"
                            onClick={() => setBranchCategory(category)}
                            title="Pilih cabang yang memakai kategori ini"
                            variant="secondary"
                            size="sm"
                            className="mr-1 self-center"
                          >
                            <Store className="h-3.5 w-3.5" />
                            Tambahkan di Cabang
                          </Button>
                        )}

                        <IconButton
                          type="button"
                          onClick={() => openEditForm(category)}
                          aria-label="Edit kategori"
                          variant="soft"
                          size="lg"
                          title="Edit kategori"
                        >
                          <Pencil size={17} />
                        </IconButton>

                        <IconButton
                          type="button"
                          onClick={() => handleDelete(category)}
                          aria-label="Hapus kategori"
                          variant="soft"
                          tone="danger"
                          size="lg"
                          title="Hapus kategori"
                        >
                          <Trash2 size={17} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {branchCategory && (
        <CategoryBranchesModal
          category={branchCategory}
          branches={productTargetBranches(activeBranch, branches)}
          canEdit={canEditProduct}
          onClose={() => setBranchCategory(null)}
        />
      )}

      {showForm && (
        <Modal size="md" padding="none" layout="clip">
          <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {editingId ? "Edit Kategori" : "Tambah Kategori"}
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Isi informasi kategori.
              </p>
            </div>

            <IconButton
              type="button"
              onClick={closeForm}
              disabled={saving}
              aria-label="Tutup"
              variant="soft"
              size="lg"
            >
              <X size={20} />
            </IconButton>
          </div>

          <div className="space-y-4 p-6">
            {error && (
              <div className="rounded-md border border-lco-coral/30 bg-lco-coral/10 px-4 py-3 text-sm text-lco-coral">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Nama Kategori
              </label>
              <Input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((current) => ({ ...current, name: e.target.value }))
                }
                disabled={saving}
                placeholder="Contoh: Kaos"
                size="lg"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Urutan
              </label>
              <Input
                type="number"
                min="0"
                value={form.sort_order}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    sort_order: e.target.value,
                  }))
                }
                disabled={saving}
                size="lg"
                className="font-mono tabular-nums"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    is_active: e.target.checked,
                  }))
                }
                disabled={saving}
                className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
              />

              <div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Kategori aktif
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Kategori aktif akan tersedia saat membuat produk.
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <Button
              type="button"
              onClick={closeForm}
              disabled={saving}
              variant="secondary"
              size="lg"
            >
              Batal
            </Button>

            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              size="lg"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
