// hooks/useBranches.ts
// ── BARU (migration 047, multi cabang) ── Kelola cabang di Pengaturan > Toko & Struk:
// daftar (termasuk yang nonaktif), tambah, ubah, aktif/nonaktifkan.
//
// Beda dengan `useActiveBranch` (hanya cabang AKTIF yang boleh diakses user, untuk
// pemilih cabang & filter data), hook ini memuat SEMUA cabang yang terlihat oleh
// user untuk layar pengaturan. RLS: tambah = izin pengaturan_toko.create, ubah =
// pengaturan_toko.edit. Cabang tidak bisa dihapus (data transaksi merujuk ke sana).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRANCH_COLUMNS, type Branch } from "@/lib/pos/branches";
import { reloadBranches } from "@/hooks/useActiveBranch";

const supabase = createClient();

export interface BranchInput {
  name: string;
  code?: string;
  address?: string;
  phone?: string;
}

function clean(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

function friendlyError(message: string): string {
  if (/branches_name_unique_idx/.test(message)) return "Nama cabang sudah dipakai cabang lain.";
  if (/branches_code_unique_idx/.test(message)) return "Kode cabang sudah dipakai cabang lain.";
  if (/branches_name_not_blank/.test(message)) return "Nama cabang minimal 2 karakter.";
  if (/row-level security|permission denied/i.test(message)) {
    return "Anda tidak punya izin untuk mengubah cabang.";
  }
  return message;
}

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("branches")
      .select(BRANCH_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      setBranches([]);
    } else {
      setBranches((data ?? []) as Branch[]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pola fetch-on-mount yang sama dengan hook lain di app ini
    void fetchAll();
  }, [fetchAll]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchAll(), reloadBranches()]);
  }, [fetchAll]);

  const addBranch = useCallback(
    async (input: BranchInput) => {
      const name = input.name.trim();
      if (name.length < 2) throw new Error("Nama cabang minimal 2 karakter.");
      const nextOrder = branches.reduce((max, b) => Math.max(max, b.sort_order), -1) + 1;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("branches").insert({
        name,
        code: clean(input.code),
        address: clean(input.address),
        phone: clean(input.phone),
        sort_order: nextOrder,
        created_by: user?.id ?? null,
      });
      if (insertError) throw new Error(friendlyError(insertError.message));
      await refreshAll();
    },
    [branches, refreshAll],
  );

  const updateBranch = useCallback(
    async (id: string, input: BranchInput) => {
      const name = input.name.trim();
      if (name.length < 2) throw new Error("Nama cabang minimal 2 karakter.");
      const { error: updateError } = await supabase
        .from("branches")
        .update({
          name,
          code: clean(input.code),
          address: clean(input.address),
          phone: clean(input.phone),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (updateError) throw new Error(friendlyError(updateError.message));
      await refreshAll();
    },
    [refreshAll],
  );

  const setBranchActive = useCallback(
    async (id: string, isActive: boolean) => {
      if (!isActive && branches.filter((b) => b.is_active).length <= 1) {
        throw new Error("Minimal harus ada satu cabang aktif.");
      }
      const { error: updateError } = await supabase
        .from("branches")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (updateError) throw new Error(friendlyError(updateError.message));
      await refreshAll();
    },
    [branches, refreshAll],
  );

  return { branches, isLoading, error, refetch: fetchAll, addBranch, updateBranch, setBranchActive };
}
