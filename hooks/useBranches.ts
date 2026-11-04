// hooks/useBranches.ts
// ── BARU (migration 047, multi cabang) ── Kelola cabang di Pengaturan > Outlet:
// daftar (termasuk yang nonaktif), tambah, ubah, aktif/nonaktifkan.
// ── PERUBAHAN (migration 048) ── Tiap outlet menyimpan pengaturan sendiri:
// zona waktu, PPN, service charge, pembulatan, poin member, dan format struk.
//
// Beda dengan `useActiveBranch` (hanya cabang AKTIF yang boleh diakses user, untuk
// pemilih cabang & filter data), hook ini memuat SEMUA cabang yang terlihat oleh
// user untuk layar pengaturan. RLS: tambah = izin pengaturan_toko.create, ubah =
// pengaturan_toko.edit. Cabang tidak bisa dihapus (data transaksi merujuk ke sana).

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BRANCH_BASE_COLUMNS,
  BRANCH_COLUMNS,
  isMissingBranchColumnError,
  normalizeBranch,
  type Branch,
  type BranchFormValues,
} from "@/lib/pos/branches";
import { reloadBranches } from "@/hooks/useActiveBranch";

const supabase = createClient();

/** Isi form outlet (lihat BranchFormValues di lib/pos/branches.ts). */
export type BranchInput = BranchFormValues;

function clean(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

/** Kolom yang ditulis ke tabel `branches` dari isi form (teks kosong -> null). */
function toRow(input: BranchInput) {
  return {
    name: input.name.trim(),
    code: clean(input.code),
    address: clean(input.address),
    phone: clean(input.phone),
    is_active: input.is_active,
    timezone: input.timezone.trim(),
    rounding_step: input.rounding_step,
    ppn_enabled: input.ppn_enabled,
    ppn_rate: input.ppn_rate,
    service_charge_enabled: input.service_charge_enabled,
    service_charge_rate: input.service_charge_rate,
    loyalty_enabled: input.loyalty_enabled,
    loyalty_spend_per_point: input.loyalty_spend_per_point,
    loyalty_point_value: input.loyalty_point_value,
    paper_thermal: input.paper_thermal,
    auto_print: input.auto_print,
    receipt_header: clean(input.receipt_header),
    receipt_footer: clean(input.receipt_footer),
  };
}

function friendlyError(message: string): string {
  if (isMissingBranchColumnError(message)) {
    return "Database belum diperbarui. Jalankan migration 048_outlet_settings.sql di Supabase terlebih dulu.";
  }
  if (/branches_(ppn|service)_rate_range/.test(message)) return "Tarif pajak/service charge harus antara 0 dan 100%.";
  if (/branches_loyalty_values_positive/.test(message)) return "Nilai poin harus minimal 1.";
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
    const first = await supabase
      .from("branches")
      .select(BRANCH_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    let rows: unknown = first.data;
    let fetchError: { message: string } | null = first.error;
    // Migration 048 belum dijalankan: tampilkan cabang dengan kolom dasar.
    if (fetchError && isMissingBranchColumnError(fetchError.message)) {
      const retry = await supabase
        .from("branches")
        .select(BRANCH_BASE_COLUMNS)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      rows = retry.data;
      fetchError = retry.error;
    }
    if (fetchError) {
      setError(fetchError.message);
      setBranches([]);
    } else {
      setBranches(
        ((rows ?? []) as Record<string, unknown>[]).map(normalizeBranch),
      );
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
      if (name.length < 2) throw new Error("Nama outlet minimal 2 karakter.");
      const nextOrder = branches.reduce((max, b) => Math.max(max, b.sort_order), -1) + 1;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("branches").insert({
        ...toRow(input),
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
      if (name.length < 2) throw new Error("Nama outlet minimal 2 karakter.");
      // Outlet terakhir yang aktif tidak boleh dinonaktifkan lewat form.
      const current = branches.find((b) => b.id === id);
      if (
        current?.is_active &&
        !input.is_active &&
        branches.filter((b) => b.is_active).length <= 1
      ) {
        throw new Error("Minimal harus ada satu outlet aktif.");
      }
      const { error: updateError } = await supabase
        .from("branches")
        .update({ ...toRow(input), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (updateError) throw new Error(friendlyError(updateError.message));
      await refreshAll();
    },
    [branches, refreshAll],
  );

  const setBranchActive = useCallback(
    async (id: string, isActive: boolean) => {
      if (!isActive && branches.filter((b) => b.is_active).length <= 1) {
        throw new Error("Minimal harus ada satu outlet aktif.");
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
