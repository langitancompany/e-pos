// Logika murni menu Pengeluaran (tanpa React/Supabase) supaya bisa dites.
// Tanggal pengeluaran adalah kolom `date` polos ("YYYY-MM-DD"); jangan diparse
// dengan new Date("YYYY-MM-DD"), itu dibaca UTC dan bisa mundur sehari di WIB.

import { addDays, dateKey } from "./dateRange";

export interface ExpenseCategory {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ExpenseRecord {
  id: string;
  branch_id: string | null;
  category_id: string | null;
  category_name: string | null;
  spent_at: string;
  amount: number;
  description: string;
  created_by_name: string | null;
  created_at: string;
}

export type ExpensePreset =
  | "this_month"
  | "today"
  | "7d"
  | "last_month"
  | "all"
  | "custom";

export const EXPENSE_PRESETS: { key: ExpensePreset; label: string }[] = [
  { key: "this_month", label: "Bulan Ini" },
  { key: "today", label: "Hari Ini" },
  { key: "7d", label: "7 Hari" },
  { key: "last_month", label: "Bulan Lalu" },
  { key: "all", label: "Semua" },
];

export const UNCATEGORIZED_LABEL = "Tanpa kategori";

export interface DateKeyRange {
  from: string;
  to: string;
}

/** Rentang "YYYY-MM-DD" untuk satu preset. "" di kedua sisi = tanpa batas. */
export function presetToDateKeys(
  preset: Exclude<ExpensePreset, "custom">,
  now: Date = new Date(),
): DateKeyRange {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case "today":
      return { from: dateKey(now), to: dateKey(now) };
    case "7d":
      return { from: dateKey(addDays(now, -6)), to: dateKey(now) };
    case "last_month":
      return {
        from: dateKey(new Date(year, month - 1, 1)),
        to: dateKey(new Date(year, month, 0)),
      };
    case "all":
      return { from: "", to: "" };
    case "this_month":
    default:
      return {
        from: dateKey(new Date(year, month, 1)),
        to: dateKey(new Date(year, month + 1, 0)),
      };
  }
}

function parseDateKey(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

const longDateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "2 November 2026" dari "2026-11-02". Kosong atau rusak jadi "-". */
export function formatLongDate(value: string | null): string {
  if (!value) return "-";
  const date = parseDateKey(value);
  return date ? longDateFormatter.format(date) : "-";
}

export function formatPeriodLabel(range: DateKeyRange): string {
  if (!range.from && !range.to) return "Semua periode";
  if (range.from && range.to) {
    return `${formatLongDate(range.from)} s/d ${formatLongDate(range.to)}`;
  }
  return range.from
    ? `Sejak ${formatLongDate(range.from)}`
    : `Sampai ${formatLongDate(range.to)}`;
}

export interface ExpenseFilter {
  search: string;
  /** "" = semua kategori, "none" = tanpa kategori, selain itu id kategori. */
  categoryId: string;
}

export const NO_CATEGORY_FILTER = "none";

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

export function filterExpenses(
  rows: ExpenseRecord[],
  filter: ExpenseFilter,
): ExpenseRecord[] {
  const needle = filter.search.trim().toLowerCase();
  const needleDigits = digitsOf(needle);

  return rows.filter((row) => {
    if (filter.categoryId === NO_CATEGORY_FILTER) {
      if (row.category_id !== null) return false;
    } else if (filter.categoryId && row.category_id !== filter.categoryId) {
      return false;
    }

    if (!needle) return true;

    const haystack = [row.description, row.category_name, row.created_by_name]
      .filter((part): part is string => !!part)
      .join(" ")
      .toLowerCase();

    if (haystack.includes(needle)) return true;
    return needleDigits !== "" && String(row.amount).includes(needleDigits);
  });
}

export interface CategoryCounts {
  all: number;
  uncategorized: number;
  byId: Record<string, number>;
}

/** Jumlah catatan per kategori, untuk angka di samping nama pada filter kategori. */
export function countByCategory(rows: ExpenseRecord[]): CategoryCounts {
  const byId: Record<string, number> = {};
  let uncategorized = 0;
  for (const row of rows) {
    if (row.category_id === null) uncategorized += 1;
    else byId[row.category_id] = (byId[row.category_id] ?? 0) + 1;
  }
  return { all: rows.length, uncategorized, byId };
}

export interface ExpenseSummary {
  total: number;
  count: number;
  average: number;
  topCategory: { name: string; total: number } | null;
}

export function summarizeExpenses(rows: ExpenseRecord[]): ExpenseSummary {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const count = rows.length;

  const perCategory = new Map<string, number>();
  for (const row of rows) {
    const name = row.category_name ?? UNCATEGORIZED_LABEL;
    perCategory.set(name, (perCategory.get(name) ?? 0) + row.amount);
  }

  let topCategory: ExpenseSummary["topCategory"] = null;
  for (const [name, sum] of perCategory) {
    if (
      !topCategory ||
      sum > topCategory.total ||
      (sum === topCategory.total && name.localeCompare(topCategory.name) < 0)
    ) {
      topCategory = { name, total: sum };
    }
  }

  return {
    total,
    count,
    average: count === 0 ? 0 : Math.round(total / count),
    topCategory,
  };
}

export interface ExpenseFormInput {
  spentAt: string;
  amountDigits: string;
  description: string;
}

export type ExpenseFormErrors = Partial<Record<keyof ExpenseFormInput, string>>;

export interface ExpenseFormValue {
  spentAt: string;
  amount: number;
  description: string;
}

export const MAX_EXPENSE_AMOUNT = 999_999_999_999;

export function validateExpenseForm(
  input: ExpenseFormInput,
  today: string,
):
  | { ok: true; value: ExpenseFormValue }
  | { ok: false; errors: ExpenseFormErrors } {
  const errors: ExpenseFormErrors = {};

  if (!input.spentAt) {
    errors.spentAt = "Tanggal wajib diisi.";
  } else if (!parseDateKey(input.spentAt)) {
    errors.spentAt = "Tanggal tidak valid.";
  } else if (input.spentAt > today) {
    errors.spentAt = "Tanggal tidak boleh di masa depan.";
  }

  const amount = Number(digitsOf(input.amountDigits));
  if (!input.amountDigits || !Number.isFinite(amount) || amount <= 0) {
    errors.amountDigits = "Nominal harus lebih dari 0.";
  } else if (amount > MAX_EXPENSE_AMOUNT) {
    errors.amountDigits = "Nominal terlalu besar.";
  }

  const description = input.description.trim();
  if (!description) errors.description = "Keterangan wajib diisi.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { spentAt: input.spentAt, amount, description } };
}

/** Nama kategori valid: minimal 2 karakter setelah dirapikan (sama dengan constraint database). */
export function validateCategoryName(
  name: string,
  existing: ExpenseCategory[],
  editingId: string | null,
): string | null {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 2) return "Nama kategori minimal 2 karakter.";

  const duplicate = existing.some(
    (category) =>
      category.id !== editingId &&
      category.name.trim().toLowerCase() === clean.toLowerCase(),
  );
  return duplicate ? `Kategori "${clean}" sudah ada.` : null;
}
