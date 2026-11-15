"use client";

import { useId, useState, type FormEvent } from "react";
import { Tag } from "lucide-react";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import {
  validateCategoryName,
  type ExpenseCategory,
} from "@/lib/pos/expenseLogic";

interface CategoryFormModalProps {
  /** Terisi = ganti nama, kosong = kategori baru. */
  category: ExpenseCategory | null;
  existing: ExpenseCategory[];
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export default function CategoryFormModal({
  category,
  existing,
  onSubmit,
  onClose,
}: CategoryFormModalProps) {
  const isEdit = category !== null;
  const uid = useId();

  const [name, setName] = useState(category?.name ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const problem = validateCategoryName(name, existing, category?.id ?? null);
    if (problem) {
      setFieldError(problem);
      setSubmitError(null);
      return;
    }

    setFieldError(null);
    setSubmitError(null);
    setIsSaving(true);

    try {
      await onSubmit(name.trim().replace(/\s+/g, " "));
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Gagal menyimpan kategori.",
      );
      setIsSaving(false);
    }
  };

  const title = isEdit ? "Ubah Nama Kategori" : "Tambah Kategori Pengeluaran";

  return (
    <Modal
      size="md"
      aria-labelledby={`${uid}-title`}
      onEscape={isSaving ? undefined : onClose}
    >
      <ModalHeader
        title={<span id={`${uid}-title`}>{title}</span>}
        icon={<Tag className="h-4 w-4 text-lco-green dark:text-lco-teal" />}
        onClose={onClose}
        closeDisabled={isSaving}
        className="mb-1"
      />
      <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
        Pengelompokan jenis pengeluaran operasional outlet.
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <div>
          <label
            htmlFor={`${uid}-name`}
            className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Nama Kategori <span aria-hidden="true">*</span>
          </label>
          <Input
            id={`${uid}-name`}
            size="lg"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
            placeholder="Contoh: Utilitas Listrik & Air, Gaji Karyawan, Transportasi"
            autoFocus
            aria-required="true"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${uid}-name-error` : undefined}
          />
          {fieldError && (
            <p
              id={`${uid}-name-error`}
              className="mt-1 text-xs text-red-700 dark:text-lco-coral"
            >
              {fieldError}
            </p>
          )}
        </div>

        {submitError && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Batal
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving
              ? "Menyimpan..."
              : isEdit
                ? "Simpan Perubahan"
                : "Buat Kategori"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
