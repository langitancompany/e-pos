"use client";

import { useState } from "react";
import { AlertTriangle, Inbox, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import type { ExpenseCategory } from "@/lib/pos/expenseLogic";
import CategoryFormModal from "./CategoryFormModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

interface ExpenseCategoriesTabProps {
  categories: ExpenseCategory[];
  isLoading: boolean;
  error: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onRefetch: () => void;
  onSave: (id: string | null, name: string) => Promise<void>;
  onSetActive: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNotify: (message: string, variant?: "success" | "error") => void;
}

type ModalState =
  | { kind: "none" }
  | { kind: "form"; category: ExpenseCategory | null }
  | { kind: "delete"; category: ExpenseCategory };

// Target sentuh 44px di layar kecil, ukuran ikon biasa di desktop.
const ACTION_SIZE = "min-h-11 min-w-11 md:min-h-0 md:min-w-0";

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-lco-teal/15 text-lco-green dark:text-lco-teal"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {active ? "Aktif" : "Nonaktif"}
    </span>
  );
}

interface CategoryActionsProps {
  category: ExpenseCategory;
  canEdit: boolean;
  canDelete: boolean;
  isPending: boolean;
  onRename: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function CategoryActions({
  category,
  canEdit,
  canDelete,
  isPending,
  onRename,
  onToggle,
  onDelete,
}: CategoryActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <>
          <IconButton
            type="button"
            variant="soft"
            size="lg"
            className={ACTION_SIZE}
            aria-label={`Ubah nama kategori ${category.name}`}
            onClick={onRename}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            disabled={isPending}
            onClick={onToggle}
          >
            {category.is_active ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        </>
      )}
      {canDelete && (
        <IconButton
          type="button"
          variant="soft"
          tone="danger"
          size="lg"
          className={ACTION_SIZE}
          aria-label={`Hapus kategori ${category.name}`}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}

export default function ExpenseCategoriesTab({
  categories,
  isLoading,
  error,
  canCreate,
  canEdit,
  canDelete,
  onRefetch,
  onSave,
  onSetActive,
  onDelete,
  onNotify,
}: ExpenseCategoriesTabProps) {
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [pendingId, setPendingId] = useState<string | null>(null);

  const closeModal = () => setModal({ kind: "none" });
  const showActions = canEdit || canDelete;

  const toggleActive = async (category: ExpenseCategory) => {
    setPendingId(category.id);
    try {
      await onSetActive(category.id, !category.is_active);
      onNotify(
        category.is_active
          ? `Kategori "${category.name}" dinonaktifkan.`
          : `Kategori "${category.name}" diaktifkan.`,
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : "Gagal mengubah status kategori.",
        "error",
      );
    } finally {
      setPendingId(null);
    }
  };

  const actionsFor = (category: ExpenseCategory) => (
    <CategoryActions
      category={category}
      canEdit={canEdit}
      canDelete={canDelete}
      isPending={pendingId === category.id}
      onRename={() => setModal({ kind: "form", category })}
      onToggle={() => toggleActive(category)}
      onDelete={() => setModal({ kind: "delete", category })}
    />
  );

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">
            Kategori Pengeluaran
          </h3>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Kelola daftar kategori (Listrik, Gaji, dll) untuk pencatatan kas
            keluar.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!isLoading && !error && (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {categories.length} kategori
            </span>
          )}
          {canCreate && (
            <Button
              type="button"
              size="lg"
              className="min-h-11 md:min-h-0"
              onClick={() => setModal({ kind: "form", category: null })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Tambah Kategori
            </Button>
          )}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-600 dark:text-zinc-400"
          >
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Memuat kategori...
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 p-4 text-sm text-red-800 dark:text-red-300"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={onRefetch}>
              Coba lagi
            </Button>
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <Inbox
              className="mb-2 h-6 w-6 text-zinc-400 dark:text-zinc-500"
              aria-hidden="true"
            />
            <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-300">
              Belum ada kategori. Pengeluaran tetap bisa dicatat tanpa kategori,
              tapi kategori membantu melihat biaya terbesar.
            </p>
            {canCreate && (
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => setModal({ kind: "form", category: null })}
              >
                Tambah kategori pertama
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900 md:hidden">
              {categories.map((category, index) => (
                <li
                  key={category.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span className="w-6 text-sm text-zinc-600 dark:text-zinc-400">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-sm font-medium">
                    {category.name}
                  </span>
                  <StatusBadge active={category.is_active} />
                  {showActions && actionsFor(category)}
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th scope="col" className="w-12 px-4 py-3">
                      No
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Nama Kategori
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                    {showActions && (
                      <th scope="col" className="px-4 py-3 text-right">
                        Aksi
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {categories.map((category, index) => (
                    <tr
                      key={category.id}
                      className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {index + 1}
                      </td>
                      <td className="break-words px-4 py-3 font-medium">
                        {category.name}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge active={category.is_active} />
                      </td>
                      {showActions && (
                        <td className="px-4 py-3">{actionsFor(category)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {modal.kind === "form" && (
        <CategoryFormModal
          category={modal.category}
          existing={categories}
          onClose={closeModal}
          onSubmit={async (name) => {
            await onSave(modal.category?.id ?? null, name);
            onNotify(
              modal.category ? "Nama kategori diperbarui." : "Kategori ditambahkan.",
            );
          }}
        />
      )}

      {modal.kind === "delete" && (
        <ConfirmDeleteModal
          title="Hapus Kategori"
          description={`Kategori "${modal.category.name}" akan dihapus permanen. Kategori yang sudah dipakai pengeluaran tidak bisa dihapus, nonaktifkan saja.`}
          confirmLabel="Hapus Kategori"
          onClose={closeModal}
          onConfirm={async () => {
            await onDelete(modal.category.id);
            onNotify("Kategori dihapus.");
          }}
        />
      )}
    </div>
  );
}
