"use client";

import { useId, useState, type FormEvent } from "react";
import { Receipt } from "lucide-react";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Select from "@/app/components/ui/Select";
import MoneyInput from "@/app/components/ui/MoneyInput";
import { dateKey } from "@/lib/pos/dateRange";
import {
  validateExpenseForm,
  type ExpenseCategory,
  type ExpenseFormErrors,
  type ExpenseRecord,
} from "@/lib/pos/expenseLogic";

interface ExpenseFormModalProps {
  /** Terisi = mode ubah, kosong = catat baru. */
  expense: ExpenseRecord | null;
  categories: ExpenseCategory[];
  onSubmit: (value: {
    categoryId: string | null;
    spentAt: string;
    amount: number;
    description: string;
  }) => Promise<void>;
  onClose: () => void;
}

const labelClass =
  "mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300";
const errorClass = "mt-1 text-xs text-red-700 dark:text-lco-coral";

export default function ExpenseFormModal({
  expense,
  categories,
  onSubmit,
  onClose,
}: ExpenseFormModalProps) {
  const isEdit = expense !== null;
  const today = dateKey(new Date());
  const uid = useId();

  // Catatan baru memilih kategori aktif pertama (seperti di aplikasi acuan); bisa diganti ke "Tanpa kategori".
  const [categoryId, setCategoryId] = useState(
    expense
      ? (expense.category_id ?? "")
      : (categories.find((category) => category.is_active)?.id ?? ""),
  );
  const [spentAt, setSpentAt] = useState(expense?.spent_at ?? today);
  const [amountDigits, setAmountDigits] = useState(
    expense ? String(expense.amount) : "",
  );
  const [description, setDescription] = useState(expense?.description ?? "");
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Kategori nonaktif hanya ditawarkan kalau sedang dipakai pengeluaran ini.
  const options = categories.filter(
    (category) => category.is_active || category.id === expense?.category_id,
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const result = validateExpenseForm({ spentAt, amountDigits, description }, today);
    if (!result.ok) {
      setErrors(result.errors);
      setSubmitError(null);
      return;
    }

    setErrors({});
    setSubmitError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        categoryId: categoryId || null,
        spentAt: result.value.spentAt,
        amount: result.value.amount,
        description: result.value.description,
      });
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Gagal menyimpan pengeluaran.",
      );
      setIsSaving(false);
    }
  };

  const title = isEdit ? "Edit Pengeluaran" : "Catat Pengeluaran Baru";

  return (
    <Modal
      size="md"
      aria-labelledby={`${uid}-title`}
      onEscape={isSaving ? undefined : onClose}
    >
      <ModalHeader
        title={<span id={`${uid}-title`}>{title}</span>}
        icon={<Receipt className="h-4 w-4 text-lco-green dark:text-lco-teal" />}
        onClose={onClose}
        closeDisabled={isSaving}
        className="mb-1"
      />
      <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
        Catatan biaya operasional outlet untuk perhitungan laba rugi.
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <div>
          <label htmlFor={`${uid}-category`} className={labelClass}>
            Kategori Pengeluaran
          </label>
          <Select
            id={`${uid}-category`}
            size="lg"
            fullWidth
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={isSaving}
            autoFocus
          >
            <option value="">Tanpa kategori</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.is_active ? "" : " (nonaktif)"}
              </option>
            ))}
          </Select>
          {categories.length === 0 && (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Belum ada kategori. Tambahkan di tab Kategori, atau catat tanpa
              kategori.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-date`} className={labelClass}>
              Tanggal Pengeluaran <span aria-hidden="true">*</span>
            </label>
            <Input
              id={`${uid}-date`}
              type="date"
              size="lg"
              value={spentAt}
              max={today}
              onChange={(e) => setSpentAt(e.target.value)}
              disabled={isSaving}
              aria-required="true"
              aria-invalid={errors.spentAt ? true : undefined}
              aria-describedby={errors.spentAt ? `${uid}-date-error` : undefined}
            />
            {errors.spentAt && (
              <p id={`${uid}-date-error`} className={errorClass}>
                {errors.spentAt}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${uid}-amount`} className={labelClass}>
              Nominal (Rp) <span aria-hidden="true">*</span>
            </label>
            <MoneyInput
              id={`${uid}-amount`}
              size="lg"
              className="tabular-nums"
              value={amountDigits}
              onValueChange={setAmountDigits}
              disabled={isSaving}
              placeholder="0"
              aria-required="true"
              aria-invalid={errors.amountDigits ? true : undefined}
              aria-describedby={
                errors.amountDigits ? `${uid}-amount-error` : undefined
              }
            />
            {errors.amountDigits && (
              <p id={`${uid}-amount-error`} className={errorClass}>
                {errors.amountDigits}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-desc`} className={labelClass}>
            Keterangan / Keperluan <span aria-hidden="true">*</span>
          </label>
          <Input
            id={`${uid}-desc`}
            size="lg"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSaving}
            placeholder="Contoh: Beli token listrik, sabun cuci piring"
            aria-required="true"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? `${uid}-desc-error` : undefined}
          />
          {errors.description && (
            <p id={`${uid}-desc-error`} className={errorClass}>
              {errors.description}
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
                : "Catat Pengeluaran"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
