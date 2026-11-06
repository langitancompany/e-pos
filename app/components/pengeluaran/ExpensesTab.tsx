"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Inbox, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useExpenses } from "@/hooks/useExpenses";
import Button from "@/app/components/ui/Button";
import Chip from "@/app/components/ui/Chip";
import Input from "@/app/components/ui/Input";
import Select from "@/app/components/ui/Select";
import { formatNumber, formatRupiah } from "../stok/stokUtils";
import {
  EXPENSE_PRESETS,
  NO_CATEGORY_FILTER,
  countByCategory,
  filterExpenses,
  formatLongDate,
  formatPeriodLabel,
  presetToDateKeys,
  summarizeExpenses,
  type DateKeyRange,
  type ExpenseCategory,
  type ExpensePreset,
  type ExpenseRecord,
} from "@/lib/pos/expenseLogic";
import ExpenseFormModal from "./ExpenseFormModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import ExpenseList from "./ExpenseList";

interface ExpensesTabProps {
  categories: ExpenseCategory[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onNotify: (message: string, variant?: "success" | "error") => void;
}

type ModalState =
  | { kind: "none" }
  | { kind: "form"; expense: ExpenseRecord | null }
  | { kind: "delete"; expense: ExpenseRecord };

const labelClass =
  "mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300";

function SummaryCard({
  label,
  value,
  caption,
  featured = false,
}: {
  label: string;
  value: string;
  caption: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${
        featured ? "col-span-2 lg:col-span-1" : ""
      }`}
    >
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-1 break-words font-mono font-semibold tabular-nums ${
          featured
            ? "text-2xl text-red-700 dark:text-lco-coral"
            : "text-lg text-zinc-900 dark:text-zinc-100"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{caption}</p>
    </div>
  );
}

export default function ExpensesTab({
  categories,
  canCreate,
  canEdit,
  canDelete,
  onNotify,
}: ExpensesTabProps) {
  const [preset, setPreset] = useState<ExpensePreset>("this_month");
  const [range, setRange] = useState<DateKeyRange>(() =>
    presetToDateKeys("this_month"),
  );
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const { expenses, isLoading, error, isTruncated, refetch, saveExpense, deleteExpense } =
    useExpenses({ dateFrom: range.from, dateTo: range.to });

  const isFiltered = search.trim() !== "" || categoryId !== "";

  const visible = useMemo(
    () => filterExpenses(expenses, { search, categoryId }),
    [expenses, search, categoryId],
  );
  const summary = useMemo(() => summarizeExpenses(visible), [visible]);
  // Angka di filter kategori mengikuti pencarian, tapi bukan pilihan kategorinya sendiri.
  const counts = useMemo(
    () => countByCategory(filterExpenses(expenses, { search, categoryId: "" })),
    [expenses, search],
  );

  const hasData = !isLoading && !error;
  const periodLabel = formatPeriodLabel(range);

  const choosePreset = (next: Exclude<ExpensePreset, "custom">) => {
    setPreset(next);
    setRange(presetToDateKeys(next));
  };

  const changeDate = (side: keyof DateKeyRange, value: string) => {
    setPreset("custom");
    setRange((current) => ({ ...current, [side]: value }));
  };

  const resetFilters = () => {
    setSearch("");
    setCategoryId("");
  };

  const closeModal = () => setModal({ kind: "none" });

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">
            Pengeluaran Operasional
          </h3>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Catat dan pantau seluruh kas keluar operasional outlet untuk
            perhitungan laba bersih.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="min-h-11 md:min-h-0"
            onClick={refetch}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
            Segarkan
          </Button>
          {canCreate && (
            <Button
              type="button"
              size="lg"
              className="min-h-11 md:min-h-0"
              onClick={() => setModal({ kind: "form", expense: null })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Catat Pengeluaran
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          featured
          label="Total Pengeluaran"
          value={hasData ? formatRupiah(summary.total) : "-"}
          caption={isFiltered ? `${periodLabel}, hasil filter` : periodLabel}
        />
        <SummaryCard
          label="Jumlah Transaksi"
          value={hasData ? `${formatNumber(summary.count)} catatan` : "-"}
          caption="Biaya keluar tercatat"
        />
        <SummaryCard
          label="Rata-rata per Biaya"
          value={hasData ? formatRupiah(summary.average) : "-"}
          caption="Per transaksi pengeluaran"
        />
        <SummaryCard
          label="Kategori Terbesar"
          value={hasData && summary.topCategory ? summary.topCategory.name : "-"}
          caption={
            hasData && summary.topCategory
              ? formatRupiah(summary.topCategory.total)
              : "Belum ada data"
          }
        />
      </div>

      <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div>
            <label htmlFor="expense-search" className={labelClass}>
              Cari
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                aria-hidden="true"
              />
              <Input
                id="expense-search"
                type="search"
                className="pl-9 min-h-11 md:min-h-0"
                placeholder="Keterangan, nominal, staf kasir..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="expense-category-filter" className={labelClass}>
              Kategori
            </label>
            <Select
              id="expense-category-filter"
              fullWidth
              className="min-h-11 md:min-h-0"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{`Semua Kategori (${counts.all})`}</option>
              {(counts.uncategorized > 0 || categoryId === NO_CATEGORY_FILTER) && (
                <option value={NO_CATEGORY_FILTER}>
                  {`Tanpa kategori (${counts.uncategorized})`}
                </option>
              )}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {`${category.name}${category.is_active ? "" : " (nonaktif)"} (${
                    counts.byId[category.id] ?? 0
                  })`}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div
            role="group"
            aria-label="Periode cepat"
            className="flex flex-wrap gap-1.5"
          >
            {EXPENSE_PRESETS.map(({ key, label }) => (
              <Chip
                key={key}
                size="md"
                className="min-h-11 md:min-h-0"
                selected={preset === key}
                onClick={() => choosePreset(key as Exclude<ExpensePreset, "custom">)}
              >
                {label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:w-96">
            <div>
              <label htmlFor="expense-date-from" className={labelClass}>
                Dari tanggal
              </label>
              <Input
                id="expense-date-from"
                type="date"
                className="min-h-11 md:min-h-0"
                value={range.from}
                max={range.to || undefined}
                onChange={(e) => changeDate("from", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="expense-date-to" className={labelClass}>
                Sampai tanggal
              </label>
              <Input
                id="expense-date-to"
                type="date"
                className="min-h-11 md:min-h-0"
                value={range.to}
                min={range.from || undefined}
                onChange={(e) => changeDate("to", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {isTruncated && (
        <p
          role="status"
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Data terlalu banyak, hanya 5.000 pengeluaran terbaru yang dimuat.
          Persempit rentang tanggal supaya ringkasan akurat.
        </p>
      )}

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
            Memuat data pengeluaran...
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
            <Button type="button" variant="secondary" size="sm" onClick={refetch}>
              Coba lagi
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <Inbox
              className="mb-2 h-6 w-6 text-zinc-400 dark:text-zinc-500"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">Tidak ada pengeluaran ditemukan</p>
            {isFiltered && expenses.length > 0 ? (
              <>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Tidak ada catatan yang cocok dengan pencarian atau kategori
                  ini.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={resetFilters}
                >
                  Hapus pencarian dan kategori
                </Button>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Belum ada catatan di periode ini. Ubah rentang tanggal atau
                  catat pengeluaran baru.
                </p>
                {canCreate && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3"
                    onClick={() => setModal({ kind: "form", expense: null })}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Catat Pengeluaran Baru
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <ExpenseList
            rows={visible}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={(expense) => setModal({ kind: "form", expense })}
            onDelete={(expense) => setModal({ kind: "delete", expense })}
          />
        )}
      </div>

      {modal.kind === "form" && (
        <ExpenseFormModal
          expense={modal.expense}
          categories={categories}
          onClose={closeModal}
          onSubmit={async (value) => {
            await saveExpense({ id: modal.expense?.id ?? null, ...value });
            onNotify(
              modal.expense ? "Perubahan pengeluaran disimpan." : "Pengeluaran dicatat.",
            );
          }}
        />
      )}

      {modal.kind === "delete" && (
        <ConfirmDeleteModal
          title="Hapus Pengeluaran"
          description={`Pengeluaran "${modal.expense.description}" sebesar ${formatRupiah(
            modal.expense.amount,
          )} pada ${formatLongDate(modal.expense.spent_at)} akan dihapus permanen. Isinya tetap tersimpan di Log Aktivitas.`}
          confirmLabel="Hapus Pengeluaran"
          onClose={closeModal}
          onConfirm={async () => {
            await deleteExpense(modal.expense.id);
            onNotify("Pengeluaran dihapus.");
          }}
        />
      )}
    </div>
  );
}
