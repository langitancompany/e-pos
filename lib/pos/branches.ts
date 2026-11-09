// lib/pos/branches.ts
// ── BARU (migration 047, multi cabang) ── Tipe & helper murni untuk cabang.
// Tidak ada akses jaringan di sini supaya mudah dites.

export type ThermalPaper = "58mm" | "80mm";

/** Pusat dan cabang punya daftar produk sendiri; pusat bisa memasang produknya ke cabang (migration 053). */
export type BranchType = "pusat" | "cabang";

export const BRANCH_TYPE_LABEL: Record<BranchType, string> = {
  pusat: "Pusat",
  cabang: "Cabang",
};

/** Nilai pembulatan yang diizinkan (0 = tidak dibulatkan). Cermin constraint migration 048. */
export const ROUNDING_STEPS = [0, 100, 500, 1000] as const;

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  sort_order: number;
  /** Migration 053. Database tanpa kolom ini: semua outlet terbaca sebagai cabang. */
  branch_type: BranchType;
  // ── migration 048 (pengaturan per outlet) ──
  timezone: string;
  ppn_enabled: boolean;
  ppn_rate: number;
  service_charge_enabled: boolean;
  service_charge_rate: number;
  rounding_step: number;
  loyalty_enabled: boolean;
  loyalty_spend_per_point: number;
  loyalty_point_value: number;
  paper_thermal: ThermalPaper;
  auto_print: boolean;
  receipt_header: string | null;
  receipt_footer: string | null;
  /**
   * BUKAN kolom database. True kalau baris ini datang dengan kolom migration 048.
   * False (database belum di-migrate) -> pengaturan global dibiarkan berlaku,
   * jangan ditimpa nilai bawaan outlet.
   */
  has_settings: boolean;
  /** BUKAN kolom database. False kalau baris datang tanpa kolom migration 053 (jenis outlet belum dikenal). */
  has_type: boolean;
}

/** Kolom dasar (migration 047). Dipakai sebagai cadangan kalau migration 048 belum dijalankan. */
export const BRANCH_BASE_COLUMNS = "id, name, code, address, phone, is_active, sort_order";

/** Kolom sampai migration 048. Cadangan kalau migration 053 (jenis outlet) belum dijalankan. */
export const BRANCH_COLUMNS_NO_TYPE = `${BRANCH_BASE_COLUMNS}, timezone, ppn_enabled, ppn_rate, service_charge_enabled, service_charge_rate, rounding_step, loyalty_enabled, loyalty_spend_per_point, loyalty_point_value, paper_thermal, auto_print, receipt_header, receipt_footer`;

export const BRANCH_COLUMNS = `${BRANCH_COLUMNS_NO_TYPE}, branch_type`;

/** Nilai awal pengaturan outlet baru (sama dengan form "Tambah Outlet Baru"). */
export const BRANCH_SETTING_DEFAULTS = {
  timezone: "Asia/Jakarta",
  ppn_enabled: false,
  ppn_rate: 11,
  service_charge_enabled: false,
  service_charge_rate: 0,
  rounding_step: 0,
  loyalty_enabled: false,
  loyalty_spend_per_point: 1000,
  loyalty_point_value: 1,
  paper_thermal: "58mm" as ThermalPaper,
  auto_print: true,
  receipt_header: null as string | null,
  receipt_footer: "Terima kasih!" as string | null,
};

/**
 * Lengkapi baris cabang dengan nilai bawaan untuk kolom yang belum ada
 * (database belum di-migrate ke 048) atau bernilai null/aneh.
 * Nilai bawaan di sini menjaga perilaku lama: PPN mati, kertas 80mm,
 * poin mengikuti aturan lama (10.000 = 1 poin, 1 poin = Rp 100).
 */
export function normalizeBranch(row: Record<string, unknown>): Branch {
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const hasNewColumns = "loyalty_enabled" in row;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    code: str(row.code),
    address: str(row.address),
    phone: str(row.phone),
    is_active: bool(row.is_active, true),
    sort_order: num(row.sort_order, 0),
    branch_type: row.branch_type === "pusat" ? "pusat" : "cabang",
    timezone: str(row.timezone) ?? "Asia/Jakarta",
    ppn_enabled: bool(row.ppn_enabled, false),
    ppn_rate: num(row.ppn_rate, 11),
    service_charge_enabled: bool(row.service_charge_enabled, false),
    service_charge_rate: num(row.service_charge_rate, 0),
    rounding_step: num(row.rounding_step, 0),
    // Tanpa kolom 048, program poin dianggap aktif dengan aturan lama.
    loyalty_enabled: bool(row.loyalty_enabled, !hasNewColumns),
    loyalty_spend_per_point: Math.max(1, num(row.loyalty_spend_per_point, 10000)),
    loyalty_point_value: Math.max(1, num(row.loyalty_point_value, 100)),
    paper_thermal: row.paper_thermal === "58mm" ? "58mm" : "80mm",
    auto_print: bool(row.auto_print, true),
    receipt_header: str(row.receipt_header),
    receipt_footer: str(row.receipt_footer),
    has_settings: hasNewColumns,
    has_type: "branch_type" in row,
  };
}

/** Pesan error Postgres/PostgREST karena kolom migration 048 belum ada. */
export function isMissingBranchColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /column .*(timezone|ppn_|service_charge|rounding_step|loyalty_|paper_thermal|auto_print|receipt_)/i.test(
    message,
  );
}

/** Pesan error karena kolom branch_type (migration 053) belum ada. */
export function isMissingBranchTypeError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /branch_type/.test(message) && /does not exist|schema cache|Could not find/i.test(message);
}

/** Singkatan zona waktu Indonesia (WIB/WITA/WIT); zona lain ditampilkan apa adanya. */
export function timezoneLabel(timezone: string): string {
  switch (timezone) {
    case "Asia/Jakarta":
    case "Asia/Pontianak":
      return "WIB";
    case "Asia/Makassar":
      return "WITA";
    case "Asia/Jayapura":
      return "WIT";
    default:
      return timezone;
  }
}

/** True kalau `timezone` dikenali runtime (IANA, mis. "Asia/Jakarta"). */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("id-ID", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function roundingLabel(step: number): string {
  return step > 0
    ? `Dibulatkan ke Rp ${step.toLocaleString("id-ID")} terdekat`
    : "Tidak dibulatkan (Sesuai total murni)";
}

/** Input form outlet (semua teks apa adanya dari form; dibersihkan saat disimpan). */
export interface BranchFormValues {
  name: string;
  code: string;
  branch_type: BranchType;
  phone: string;
  address: string;
  timezone: string;
  is_active: boolean;
  rounding_step: number;
  ppn_enabled: boolean;
  ppn_rate: number;
  service_charge_enabled: boolean;
  service_charge_rate: number;
  loyalty_enabled: boolean;
  loyalty_spend_per_point: number;
  loyalty_point_value: number;
  paper_thermal: ThermalPaper;
  auto_print: boolean;
  receipt_header: string;
  receipt_footer: string;
}

/** Nilai awal form: dari outlet yang diedit, atau bawaan untuk outlet baru. */
export function branchToFormValues(branch: Branch | null): BranchFormValues {
  if (!branch) {
    return {
      name: "",
      code: "",
      branch_type: "cabang",
      phone: "",
      address: "",
      timezone: BRANCH_SETTING_DEFAULTS.timezone,
      is_active: true,
      rounding_step: BRANCH_SETTING_DEFAULTS.rounding_step,
      ppn_enabled: BRANCH_SETTING_DEFAULTS.ppn_enabled,
      ppn_rate: BRANCH_SETTING_DEFAULTS.ppn_rate,
      service_charge_enabled: BRANCH_SETTING_DEFAULTS.service_charge_enabled,
      service_charge_rate: BRANCH_SETTING_DEFAULTS.service_charge_rate,
      loyalty_enabled: BRANCH_SETTING_DEFAULTS.loyalty_enabled,
      loyalty_spend_per_point: BRANCH_SETTING_DEFAULTS.loyalty_spend_per_point,
      loyalty_point_value: BRANCH_SETTING_DEFAULTS.loyalty_point_value,
      paper_thermal: BRANCH_SETTING_DEFAULTS.paper_thermal,
      auto_print: BRANCH_SETTING_DEFAULTS.auto_print,
      receipt_header: BRANCH_SETTING_DEFAULTS.receipt_header ?? "",
      receipt_footer: BRANCH_SETTING_DEFAULTS.receipt_footer ?? "",
    };
  }
  return {
    name: branch.name,
    code: branch.code ?? "",
    branch_type: branch.branch_type,
    phone: branch.phone ?? "",
    address: branch.address ?? "",
    timezone: branch.timezone,
    is_active: branch.is_active,
    rounding_step: branch.rounding_step,
    ppn_enabled: branch.ppn_enabled,
    ppn_rate: branch.ppn_rate,
    service_charge_enabled: branch.service_charge_enabled,
    service_charge_rate: branch.service_charge_rate,
    loyalty_enabled: branch.loyalty_enabled,
    loyalty_spend_per_point: branch.loyalty_spend_per_point,
    loyalty_point_value: branch.loyalty_point_value,
    paper_thermal: branch.paper_thermal,
    auto_print: branch.auto_print,
    receipt_header: branch.receipt_header ?? "",
    receipt_footer: branch.receipt_footer ?? "",
  };
}

/**
 * Validasi form outlet. Mengembalikan pesan error pertama (Bahasa Indonesia)
 * dan `tab` tempat masalahnya, supaya form bisa pindah ke tab yang bermasalah.
 */
export function validateBranchForm(
  v: BranchFormValues,
  context?: { branches: Branch[]; editingId: string | null },
): { message: string; tab: "profil" | "pajak" | "struk" } | null {
  if (v.name.trim().length < 2) return { message: "Nama outlet minimal 2 karakter.", tab: "profil" };
  if (v.code.trim().length === 0) return { message: "Kode outlet wajib diisi.", tab: "profil" };
  if (v.code.trim().length > 12) return { message: "Kode outlet maksimal 12 karakter.", tab: "profil" };
  if (v.branch_type !== "pusat" && v.branch_type !== "cabang") {
    return { message: "Pilih jenis outlet: pusat atau cabang.", tab: "profil" };
  }
  if (context && v.branch_type === "pusat") {
    const other = context.branches.find((b) => b.branch_type === "pusat" && b.id !== context.editingId);
    if (other) {
      return {
        message: `Outlet pusat sudah ada: ${other.name}. Ubah jenis ${other.name} menjadi cabang dulu, baru jadikan outlet ini pusat.`,
        tab: "profil",
      };
    }
  }
  if (!v.is_active && v.branch_type === "pusat") {
    return {
      message: "Outlet pusat tidak bisa dinonaktifkan. Ubah jenisnya menjadi cabang dulu.",
      tab: "profil",
    };
  }
  if (!isValidTimezone(v.timezone)) {
    return { message: "Zona waktu tidak dikenali. Contoh: Asia/Jakarta.", tab: "profil" };
  }
  if (!(ROUNDING_STEPS as readonly number[]).includes(v.rounding_step)) {
    return { message: "Pilihan pembulatan tidak valid.", tab: "pajak" };
  }
  if (!Number.isFinite(v.ppn_rate) || v.ppn_rate < 0 || v.ppn_rate > 100) {
    return { message: "Tarif PPN harus antara 0 dan 100%.", tab: "pajak" };
  }
  if (!Number.isFinite(v.service_charge_rate) || v.service_charge_rate < 0 || v.service_charge_rate > 100) {
    return { message: "Tarif service charge harus antara 0 dan 100%.", tab: "pajak" };
  }
  if (v.loyalty_enabled) {
    if (!Number.isInteger(v.loyalty_spend_per_point) || v.loyalty_spend_per_point < 1) {
      return { message: "Rp belanja per 1 poin minimal 1.", tab: "pajak" };
    }
    if (!Number.isInteger(v.loyalty_point_value) || v.loyalty_point_value < 1) {
      return { message: "Nilai potongan per 1 poin minimal Rp 1.", tab: "pajak" };
    }
  }
  return null;
}

/**
 * Pengaturan kasir/struk yang ditimpakan oleh outlet aktif di atas pengaturan
 * global. Header/footer kosong -> `undefined` (pakai nilai global).
 */
export interface BranchSettingsOverlay {
  ppnEnabled: boolean;
  ppnRate: number;
  paperThermal: ThermalPaper;
  autoPrint: boolean;
  headerStruk: string;
  footerStruk?: string;
  loyaltyEnabled: boolean;
  loyaltySpendPerPoint: number;
  loyaltyPointValue: number;
  timezone: string;
}

export function branchSettingsOverlay(branch: Branch): BranchSettingsOverlay | null {
  // Database belum di-migrate ke 048: tidak ada pengaturan outlet untuk ditimpakan.
  if (!branch.has_settings) return null;
  const footer = (branch.receipt_footer ?? "").trim();
  return {
    ppnEnabled: branch.ppn_enabled,
    ppnRate: branch.ppn_rate,
    paperThermal: branch.paper_thermal,
    autoPrint: branch.auto_print,
    headerStruk: (branch.receipt_header ?? "").trim(),
    footerStruk: footer === "" ? undefined : footer,
    loyaltyEnabled: branch.loyalty_enabled,
    loyaltySpendPerPoint: branch.loyalty_spend_per_point,
    loyaltyPointValue: branch.loyalty_point_value,
    timezone: branch.timezone,
  };
}

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

/** Outlet pusat dari daftar, atau null kalau belum ada yang berjenis pusat. */
export function pusatBranch(branches: Branch[]): Branch | null {
  return branches.find((b) => b.branch_type === "pusat") ?? null;
}

/**
 * Peran outlet aktif untuk urusan produk:
 * "pusat" = outlet induk yang bisa memasang produknya ke cabang, "cabang" = outlet biasa,
 * "tanpa-pusat" = jenis outlet belum dikenal (belum ada outlet aktif, atau database belum
 * di-migrate 053), sehingga perilaku lama berlaku.
 * Hanya outlet aktif yang dilihat: user yang dibatasi ke cabang tidak menerima baris
 * pusat dari database.
 */
export type OutletRole = "pusat" | "cabang" | "tanpa-pusat";

export function outletRole(active: Branch | null): OutletRole {
  if (!active || !active.has_type) return "tanpa-pusat";
  return active.branch_type === "pusat" ? "pusat" : "cabang";
}

/**
 * Outlet yang boleh diatur ketersediaannya dari layar Produk di outlet aktif:
 * pusat memilih di antara cabang aktif, cabang hanya mengatur dirinya sendiri,
 * jenis outlet belum dikenal: semua outlet aktif (perilaku lama).
 */
export function productTargetBranches(active: Branch | null, branches: Branch[]): Branch[] {
  const usable = branches.filter((b) => b.is_active);
  switch (outletRole(active)) {
    case "pusat":
      return usable.filter((b) => b.branch_type === "cabang");
    case "cabang":
      return usable.filter((b) => b.id === active?.id);
    default:
      return usable;
  }
}

export interface LoyaltyRuleGroup {
  spendPerPoint: number;
  pointValue: number;
  branchNames: string[];
}

/**
 * Saldo poin pelanggan dipakai bersama semua cabang, tetapi cara mendapat dan
 * menukar poin dibaca dari cabang kasir. Kalau cabang aktif yang program poinnya
 * menyala punya aturan berbeda, pelanggan bisa memilih cabang yang paling untung.
 * Mengembalikan satu grup per aturan berbeda; lebih dari satu grup = tidak seragam.
 */
export function loyaltyRuleGroups(branches: Branch[]): LoyaltyRuleGroup[] {
  const groups = new Map<string, LoyaltyRuleGroup>();
  for (const b of branches) {
    if (!b.is_active || !b.loyalty_enabled) continue;
    const key = `${b.loyalty_spend_per_point}:${b.loyalty_point_value}`;
    const group = groups.get(key);
    if (group) group.branchNames.push(b.name);
    else
      groups.set(key, {
        spendPerPoint: b.loyalty_spend_per_point,
        pointValue: b.loyalty_point_value,
        branchNames: [b.name],
      });
  }
  return [...groups.values()];
}
