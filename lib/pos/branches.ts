// lib/pos/branches.ts
// ── BARU (migration 047, multi cabang) ── Tipe & helper murni untuk cabang.
// Tidak ada akses jaringan di sini supaya mudah dites.

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  sort_order: number;
}

export const BRANCH_COLUMNS = "id, name, code, address, phone, is_active, sort_order";

/** Kunci localStorage untuk cabang yang terakhir dipilih di perangkat ini. */
export const ACTIVE_BRANCH_STORAGE_KEY = "epos.activeBranchId";

/**
 * Pilih cabang aktif: pakai pilihan tersimpan kalau masih termasuk cabang
 * aktif yang boleh diakses user; kalau tidak, cabang aktif pertama.
 * Daftar kosong -> null (mis. migration 047 belum dijalankan).
 */
export function resolveActiveBranchId(
  branches: Branch[],
  storedId: string | null,
): string | null {
  const usable = branches.filter((b) => b.is_active);
  if (usable.length === 0) return null;
  if (storedId && usable.some((b) => b.id === storedId)) return storedId;
  return usable[0].id;
}

/**
 * Apakah user dengan `branchIds` (kosong = tanpa batasan) boleh mengakses cabang ini.
 * Cermin fungsi database `can_access_branch`.
 */
export function canAccessBranch(
  user: { isSuperAdmin: boolean; branchIds: string[] } | null,
  branchId: string,
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin || user.branchIds.length === 0) return true;
  return user.branchIds.includes(branchId);
}

/** Nama cabang dari daftar; fallback ke "Cabang tidak dikenal" kalau sudah tidak ada. */
export function branchName(branches: Branch[], id: string): string {
  return branches.find((b) => b.id === id)?.name ?? "Cabang tidak dikenal";
}

/**
 * Argumen untuk `.match()` pada query Supabase: filter cabang bila ada cabang
 * aktif, atau objek kosong (tidak memfilter) kalau belum ada cabang sama sekali
 * (mis. migration 047 belum dijalankan). Pemakaian:
 *   supabase.from("transactions").select("...").match(branchFilter(branchId))
 */
export function branchFilter(branchId: string | null): Record<string, string> {
  return branchId ? { branch_id: branchId } : {};
}
