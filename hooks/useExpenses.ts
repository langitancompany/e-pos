// hooks/useExpenses.ts
// Hook data menu Pengeluaran (migration 051):
//   - useExpenses(): daftar pengeluaran per rentang tanggal untuk cabang aktif,
//     plus catat/ubah/hapus.
//   - useExpenseCategories(): daftar kategori plus tambah/ganti nama/aktifkan/hapus.
//
// Semua tulis lewat RPC. Tabel hanya punya policy SELECT, jadi tidak ada
// INSERT/UPDATE langsung dari client. Pola sama dengan hooks/useGifts.ts.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBranchScope } from "@/hooks/useActiveBranch";
import type { ExpenseCategory, ExpenseRecord } from "@/lib/pos/expenseLogic";

const supabase = createClient();

const MIGRATION_HINT =
  "Fitur pengeluaran belum siap di database. Jalankan migration 051_expenses.sql di Supabase SQL Editor, lalu muat ulang halaman.";

function describeError(
  err: { message?: string; code?: string },
  fallback: string,
): string {
  const message = err.message ?? "";
  if (
    (err.code === "42P01" ||
      err.code === "PGRST205" ||
      err.code === "PGRST202" ||
      /expense|save_expense|delete_expense/.test(message)) &&
    /schema cache|does not exist|Could not find/.test(message)
  ) {
    return MIGRATION_HINT;
  }
  return message || fallback;
}

// Daftar dimuat per halaman 1000 baris (batas bawaan PostgREST). Di atas
// MAX_ROWS total pengeluaran terpotong, dan layar memberi peringatan.
const PAGE_SIZE = 1000;
const MAX_ROWS = 5000;

const EXPENSE_COLUMNS =
  "id, branch_id, category_id, spent_at, amount, description, created_by, created_at, expense_categories(name)";

interface RawExpense {
  id: string;
  branch_id: string | null;
  category_id: string | null;
  spent_at: string;
  amount: number | string;
  description: string;
  created_by: string | null;
  created_at: string;
  expense_categories: { name: string } | { name: string }[] | null;
}

function categoryNameOf(row: RawExpense): string | null {
  const joined = row.expense_categories;
  if (!joined) return null;
  return Array.isArray(joined) ? (joined[0]?.name ?? null) : joined.name;
}

async function toRecords(rows: RawExpense[]): Promise<ExpenseRecord[]> {
  const creatorIds = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => !!id)),
  );

  const nameById = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);

    for (const profile of profiles ?? []) {
      if (profile.full_name) nameById.set(profile.id, profile.full_name);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    branch_id: row.branch_id,
    category_id: row.category_id,
    category_name: categoryNameOf(row),
    spent_at: row.spent_at,
    amount: Number(row.amount),
    description: row.description,
    created_by_name: row.created_by ? (nameById.get(row.created_by) ?? null) : null,
    created_at: row.created_at,
  }));
}

export interface SaveExpenseParams {
  /** Kosong = catat baru. */
  id?: string | null;
  categoryId: string | null;
  spentAt: string;
  amount: number;
  description: string;
}

interface UseExpensesOptions {
  /** "YYYY-MM-DD" inklusif. Kosong = tanpa batas bawah. */
  dateFrom?: string;
  /** "YYYY-MM-DD" inklusif. Kosong = tanpa batas atas. */
  dateTo?: string;
}

interface UseExpensesResult {
  expenses: ExpenseRecord[];
  isLoading: boolean;
  error: string | null;
  isTruncated: boolean;
  refetch: () => void;
  saveExpense: (params: SaveExpenseParams) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
}

export function useExpenses(options: UseExpensesOptions = {}): UseExpensesResult {
  const { dateFrom = "", dateTo = "" } = options;
  const { branchId, ready } = useBranchScope();

  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!ready) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const collected: RawExpense[] = [];
      let truncated = false;

      for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
          .from("expenses")
          .select(EXPENSE_COLUMNS)
          .order("spent_at", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (branchId) query = query.eq("branch_id", branchId);
        if (dateFrom) query = query.gte("spent_at", dateFrom);
        if (dateTo) query = query.lte("spent_at", dateTo);

        const { data, error: fetchError } = await query;
        if (isCancelled) return;

        if (fetchError) {
          setError(describeError(fetchError, "Gagal memuat daftar pengeluaran."));
          setExpenses([]);
          setIsTruncated(false);
          setIsLoading(false);
          return;
        }

        const page = (data ?? []) as unknown as RawExpense[];
        collected.push(...page);

        if (page.length < PAGE_SIZE) break;
        if (collected.length >= MAX_ROWS) {
          truncated = true;
          break;
        }
      }

      const records = await toRecords(collected);
      if (isCancelled) return;

      setExpenses(records);
      setIsTruncated(truncated);
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [dateFrom, dateTo, branchId, ready, reloadToken]);

  const saveExpense = useCallback(
    async ({ id, categoryId, spentAt, amount, description }: SaveExpenseParams) => {
      const { data, error: rpcError } = await supabase.rpc("save_expense", {
        p_id: id ?? null,
        p_branch_id: branchId,
        p_category_id: categoryId,
        p_spent_at: spentAt,
        p_amount: amount,
        p_description: description.trim(),
      });

      if (rpcError) {
        console.error("save_expense RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal menyimpan pengeluaran."));
      }
      if (!data?.success) throw new Error("Pengeluaran gagal disimpan.");

      refetch();
    },
    [branchId, refetch],
  );

  const deleteExpense = useCallback(
    async (id: string) => {
      const { data, error: rpcError } = await supabase.rpc("delete_expense", {
        p_id: id,
      });

      if (rpcError) {
        console.error("delete_expense RPC error:", rpcError);
        throw new Error(describeError(rpcError, "Gagal menghapus pengeluaran."));
      }
      if (!data?.success) throw new Error("Pengeluaran gagal dihapus.");

      refetch();
    },
    [refetch],
  );

  return {
    expenses,
    isLoading: isLoading || !ready,
    error,
    isTruncated,
    refetch,
    saveExpense,
    deleteExpense,
  };
}

interface UseExpenseCategoriesResult {
  categories: ExpenseCategory[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  saveCategory: (id: string | null, name: string) => Promise<void>;
  setCategoryActive: (id: string, isActive: boolean) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

export function useExpenseCategories(): UseExpenseCategoriesResult {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("expense_categories")
        .select("id, name, is_active")
        .order("name", { ascending: true })
        .limit(500);

      if (isCancelled) return;

      if (fetchError) {
        setError(describeError(fetchError, "Gagal memuat kategori pengeluaran."));
        setCategories([]);
      } else {
        setCategories((data ?? []) as ExpenseCategory[]);
      }
      setIsLoading(false);
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [reloadToken]);

  const runRpc = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      fallback: string,
    ): Promise<void> => {
      const { data, error: rpcError } = await supabase.rpc(name, args);

      if (rpcError) {
        console.error(`${name} RPC error:`, rpcError);
        throw new Error(describeError(rpcError, fallback));
      }
      if (!data?.success) throw new Error(fallback);

      refetch();
    },
    [refetch],
  );

  const saveCategory = useCallback(
    (id: string | null, name: string) =>
      runRpc(
        "save_expense_category",
        { p_id: id, p_name: name.trim() },
        "Gagal menyimpan kategori.",
      ),
    [runRpc],
  );

  const setCategoryActive = useCallback(
    (id: string, isActive: boolean) =>
      runRpc(
        "set_expense_category_active",
        { p_id: id, p_active: isActive },
        "Gagal mengubah status kategori.",
      ),
    [runRpc],
  );

  const deleteCategory = useCallback(
    (id: string) =>
      runRpc("delete_expense_category", { p_id: id }, "Gagal menghapus kategori."),
    [runRpc],
  );

  return {
    categories,
    isLoading,
    error,
    refetch,
    saveCategory,
    setCategoryActive,
    deleteCategory,
  };
}
