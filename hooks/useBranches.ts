// hooks/useBranches.ts
// ── BARU (migration 047, multi cabang) ── Kelola cabang di Pengaturan > Outlet:
// daftar (termasuk yang nonaktif), tambah, ubah, aktif/nonaktifkan.
// ── PERUBAHAN (migration 048) ── Tiap outlet menyimpan pengaturan sendiri:
// zona waktu, PPN, service charge, pembulatan, poin member, dan format struk.
//
// Beda dengan `useActiveBranch` (hanya cabang AKTIF yang boleh diakses user, untuk
// pemilih cabang & filter data), hook ini memuat SEMUA cabang yang terlihat oleh
// user untuk layar pengaturan. RLS: tambah = izin pengaturan_toko.create, ubah =
// pengaturan_toko.edit. ── TAMBAHAN (migration 049) ── Hapus cabang lewat RPC
// delete_branch (izin pengaturan_toko.delete): hanya cabang yang belum punya
// riwayat; cabang yang sudah dipakai transaksi cukup dinonaktifkan.
// ── TAMBAHAN (migration 053) ── Jenis outlet pusat/cabang. Pusat tidak bisa
// dinonaktifkan atau dihapus selama masih pusat.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isMissingBranchColumnError,
  isMissingBranchTypeError,
  normalizeBranch,
  type Branch,
  type BranchFormValues,
} from "@/lib/pos/branches";
import { selectBranchRows } from "@/lib/pos/branchQuery";
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
    branch_type: input.branch_type,
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
  if (/branches_single_pusat_idx/.test(message)) {
    return "Outlet pusat sudah ada. Ubah jenis outlet pusat yang lama menjadi cabang dulu.";
  }
  if (/branches_branch_type_check/.test(message)) return "Jenis outlet harus pusat atau cabang.";
  if (isMissingBranchTypeError(message)) {
    return "Database belum diperbarui. Jalankan migration 053_branch_type.sql di Supabase terlebih dulu.";
  }
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

const PUSAT_LOCKED_MESSAGE =
  "Outlet pusat tidak bisa dinonaktifkan atau dihapus. Ubah jenisnya menjadi cabang dulu dan jadikan outlet lain sebagai pusat.";

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const { rows, errorMessage } = await selectBranchRows(supabase);
    if (errorMessage) {
      setError(errorMessage);
      setBranches([]);
    } else {
      setBranches(rows.map(normalizeBranch));
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
      if (!input.is_active && input.branch_type === "pusat") {
        throw new Error(PUSAT_LOCKED_MESSAGE);
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
      if (!isActive && branches.find((b) => b.id === id)?.branch_type === "pusat") {
        throw new Error(PUSAT_LOCKED_MESSAGE);
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

  const deleteBranch = useCallback(
    async (id: string) => {
      if (branches.find((b) => b.id === id)?.branch_type === "pusat") {
        throw new Error(PUSAT_LOCKED_MESSAGE);
      }
      const { error: rpcError } = await supabase.rpc("delete_branch", { p_branch_id: id });
      if (rpcError) {
        if (/function .*delete_branch|Could not find the function/i.test(rpcError.message)) {
          throw new Error("Database belum diperbarui. Jalankan migration 049_delete_branch.sql di Supabase terlebih dulu.");
        }
        throw new Error(friendlyError(rpcError.message));
      }
      await refreshAll();
    },
    [branches, refreshAll],
  );

  return {
    branches,
    isLoading,
    error,
    refetch: fetchAll,
    addBranch,
    updateBranch,
    setBranchActive,
    deleteBranch,
  };
}
