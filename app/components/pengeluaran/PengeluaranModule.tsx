"use client";

// Menu Pengeluaran: catatan biaya operasional per outlet (tab Pengeluaran) dan
// daftar kategorinya (tab Kategori). Tidak menyentuh kas laci/shift.
// Akses: izin modul `pengeluaran` (Lihat / Tambah / Ubah / Hapus). Yang benar-benar
// mengikat tetap RLS dan cek izin di RPC (migration 051).

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth, hasPermission, hasPermissionAction } from "@/hooks/useAuth";
import { useExpenseCategories } from "@/hooks/useExpenses";
import TabSwitcher from "@/app/components/ui/TabSwitcher";
import Toast, { type ToastVariant } from "@/app/components/ui/Toast";
import ExpensesTab from "./ExpensesTab";
import ExpenseCategoriesTab from "./ExpenseCategoriesTab";

type TabKey = "expenses" | "categories";

const TABS: { key: TabKey; label: string }[] = [
  { key: "expenses", label: "Pengeluaran" },
  { key: "categories", label: "Kategori" },
];

const TOAST_MS = 3000;

export default function PengeluaranModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [tab, setTab] = useState<TabKey>("expenses");
  const [toast, setToast] = useState<{
    message: string;
    variant: ToastVariant;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    categories,
    isLoading: isCategoriesLoading,
    error: categoriesError,
    refetch: refetchCategories,
    saveCategory,
    setCategoryActive,
    deleteCategory,
  } = useExpenseCategories();

  const notify = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ message, variant });
      toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  if (isAuthLoading) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center gap-2 bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
      >
        <Loader2
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Memuat...
      </div>
    );
  }

  if (!hasPermission(user, "pengeluaran")) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert
            className="h-6 w-6 text-red-700 dark:text-lco-coral"
            aria-hidden="true"
          />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
          Akun Anda tidak punya akses ke menu Pengeluaran. Hubungi admin kalau
          Anda perlu mencatat atau melihat pengeluaran.
        </p>
      </div>
    );
  }

  const canCreate = hasPermissionAction(user, "pengeluaran", "create");
  const canEdit = hasPermissionAction(user, "pengeluaran", "edit");
  const canDelete = hasPermissionAction(user, "pengeluaran", "delete");

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <TabSwitcher
        tabs={TABS}
        value={tab}
        onChange={setTab}
        className="mb-5"
        ariaLabel="Bagian menu Pengeluaran"
      />

      <div role="tabpanel" hidden={tab !== "expenses"}>
        <ExpensesTab
          categories={categories}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onNotify={notify}
        />
      </div>

      <div role="tabpanel" hidden={tab !== "categories"}>
        <ExpenseCategoriesTab
          categories={categories}
          isLoading={isCategoriesLoading}
          error={categoriesError}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onRefetch={refetchCategories}
          onSave={saveCategory}
          onSetActive={setCategoryActive}
          onDelete={deleteCategory}
          onNotify={notify}
        />
      </div>

      <Toast
        visible={toast !== null}
        message={toast?.message ?? ""}
        variant={toast?.variant ?? "success"}
        durationMs={TOAST_MS}
      />
    </div>
  );
}
