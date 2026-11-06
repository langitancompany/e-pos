"use client";

import { Pencil, Trash2, User } from "lucide-react";
import IconButton from "@/app/components/ui/IconButton";
import { formatRupiah } from "../stok/stokUtils";
import {
  UNCATEGORIZED_LABEL,
  formatLongDate,
  type ExpenseRecord,
} from "@/lib/pos/expenseLogic";

interface ExpenseListProps {
  rows: ExpenseRecord[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (expense: ExpenseRecord) => void;
  onDelete: (expense: ExpenseRecord) => void;
}

// Target sentuh 44px di layar kecil, ukuran ikon biasa di desktop.
const ACTION_SIZE = "min-h-11 min-w-11 md:min-h-0 md:min-w-0";

function CategoryBadge({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span className="text-xs text-zinc-600 dark:text-zinc-400">
        {UNCATEGORIZED_LABEL}
      </span>
    );
  }
  return (
    <span className="inline-block max-w-full truncate rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {name}
    </span>
  );
}

function Creator({ name }: { name: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
      <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {name ?? "-"}
    </span>
  );
}

function RowActions({
  expense,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  expense: ExpenseRecord;
} & Omit<ExpenseListProps, "rows">) {
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <IconButton
          type="button"
          variant="soft"
          size="lg"
          className={ACTION_SIZE}
          aria-label={`Edit pengeluaran ${expense.description}`}
          onClick={() => onEdit(expense)}
        >
          <Pencil className="h-4 w-4" />
        </IconButton>
      )}
      {canDelete && (
        <IconButton
          type="button"
          variant="soft"
          tone="danger"
          size="lg"
          className={ACTION_SIZE}
          aria-label={`Hapus pengeluaran ${expense.description}`}
          onClick={() => onDelete(expense)}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}

export default function ExpenseList({
  rows,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: ExpenseListProps) {
  const showActions = canEdit || canDelete;
  const actionProps = { canEdit, canDelete, onEdit, onDelete };

  return (
    <>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900 md:hidden">
        {rows.map((expense) => (
          <li key={expense.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">
                  {expense.description}
                </p>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  {formatLongDate(expense.spent_at)}
                </p>
              </div>
              <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-red-700 dark:text-lco-coral">
                {formatRupiah(expense.amount)}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <CategoryBadge name={expense.category_name} />
                <Creator name={expense.created_by_name} />
              </div>
              {showActions && <RowActions expense={expense} {...actionProps} />}
            </div>
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
                Tanggal
              </th>
              <th scope="col" className="px-4 py-3">
                Kategori
              </th>
              <th scope="col" className="px-4 py-3">
                Keterangan
              </th>
              <th scope="col" className="px-4 py-3">
                Dicatat Oleh
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Nominal
              </th>
              {showActions && (
                <th scope="col" className="px-4 py-3 text-right">
                  Aksi
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {rows.map((expense, index) => (
              <tr
                key={expense.id}
                className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              >
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {index + 1}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium">
                  {formatLongDate(expense.spent_at)}
                </td>
                <td className="px-4 py-3">
                  <CategoryBadge name={expense.category_name} />
                </td>
                <td className="max-w-xs break-words px-4 py-3">
                  {expense.description}
                </td>
                <td className="px-4 py-3">
                  <Creator name={expense.created_by_name} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold tabular-nums text-red-700 dark:text-lco-coral">
                  {formatRupiah(expense.amount)}
                </td>
                {showActions && (
                  <td className="px-4 py-3">
                    <RowActions expense={expense} {...actionProps} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
