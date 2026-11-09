import { describe, expect, it } from "vitest";
import {
  BRANCH_COLUMNS,
  BRANCH_COLUMNS_NO_TYPE,
  branchFilter,
  isMissingBranchTypeError,
  outletRole,
  productTargetBranches,
  pusatBranch,
  branchName,
  branchSettingsOverlay,
  branchToFormValues,
  canAccessBranch,
  isMissingBranchColumnError,
  isValidTimezone,
  loyaltyRuleGroups,
  normalizeBranch,
  resolveActiveBranchId,
  timezoneLabel,
  validateBranchForm,
  type Branch,
} from "../branches";

const mk = (id: string, over: Partial<Branch> = {}): Branch => ({
  ...normalizeBranch({ id, name: `Cabang ${id}`, loyalty_enabled: false }),
  ...over,
});

describe("resolveActiveBranchId", () => {
  it("memakai pilihan tersimpan bila masih aktif & boleh diakses", () => {
    expect(resolveActiveBranchId([mk("a"), mk("b")], "b")).toBe("b");
  });
  it("jatuh ke cabang aktif pertama bila pilihan tersimpan tidak ada di daftar", () => {
    expect(resolveActiveBranchId([mk("a"), mk("b")], "zzz")).toBe("a");
  });
  it("melewati cabang nonaktif", () => {
    expect(resolveActiveBranchId([mk("a", { is_active: false }), mk("b")], "a")).toBe("b");
  });
  it("daftar kosong -> null (mode tanpa cabang)", () => {
    expect(resolveActiveBranchId([], "a")).toBeNull();
  });
});

describe("canAccessBranch", () => {
  it("tanpa batasan (kosong) = semua cabang", () => {
    expect(canAccessBranch({ isSuperAdmin: false, branchIds: [] }, "x")).toBe(true);
  });
  it("dengan batasan hanya cabang yang tercantum", () => {
    const u = { isSuperAdmin: false, branchIds: ["a"] };
    expect(canAccessBranch(u, "a")).toBe(true);
    expect(canAccessBranch(u, "b")).toBe(false);
  });
  it("Super Admin selalu boleh, walau branchIds terisi", () => {
    expect(canAccessBranch({ isSuperAdmin: true, branchIds: ["a"] }, "b")).toBe(true);
  });
  it("user null ditolak", () => {
    expect(canAccessBranch(null, "a")).toBe(false);
  });
});

describe("branchFilter & branchName", () => {
  it("filter hanya bila ada cabang aktif", () => {
    expect(branchFilter("a")).toEqual({ branch_id: "a" });
    expect(branchFilter(null)).toEqual({});
  });
  it("nama cabang tidak dikenal punya fallback", () => {
    expect(branchName([mk("a")], "a")).toBe("Cabang a");
    expect(branchName([mk("a")], "q")).toBe("Cabang tidak dikenal");
  });
});


describe("normalizeBranch", () => {
  it("baris tanpa kolom migration 048 mempertahankan aturan poin lama dan menandai has_settings=false", () => {
    const b = normalizeBranch({ id: "a", name: "Pusat" });
    expect(b.has_settings).toBe(false);
    expect(b.loyalty_enabled).toBe(true);
    expect(b.loyalty_spend_per_point).toBe(10000);
    expect(b.loyalty_point_value).toBe(100);
    expect(b.paper_thermal).toBe("80mm");
  });
  it("baris dengan kolom 048 dibaca apa adanya (numeric dari Postgres bisa berupa string)", () => {
    const b = normalizeBranch({
      id: "a",
      name: "Pusat",
      loyalty_enabled: false,
      ppn_enabled: true,
      ppn_rate: "11.00",
      paper_thermal: "58mm",
      receipt_footer: "  ",
    });
    expect(b.has_settings).toBe(true);
    expect(b.loyalty_enabled).toBe(false);
    expect(b.ppn_rate).toBe(11);
    expect(b.paper_thermal).toBe("58mm");
    expect(b.receipt_footer).toBeNull();
  });
});

describe("branchSettingsOverlay", () => {
  it("null bila database belum di-migrate, supaya pengaturan global tidak tertimpa", () => {
    expect(branchSettingsOverlay(normalizeBranch({ id: "a", name: "Pusat" }))).toBeNull();
  });
  it("footer kosong -> undefined (pakai footer global), header ikut outlet", () => {
    const o = branchSettingsOverlay(
      mk("a", { ppn_enabled: true, ppn_rate: 11, receipt_header: " Halo ", receipt_footer: null }),
    );
    expect(o?.ppnEnabled).toBe(true);
    expect(o?.headerStruk).toBe("Halo");
    expect(o?.footerStruk).toBeUndefined();
  });
});

describe("timezone", () => {
  it("label WIB/WITA/WIT", () => {
    expect(timezoneLabel("Asia/Jakarta")).toBe("WIB");
    expect(timezoneLabel("Asia/Makassar")).toBe("WITA");
    expect(timezoneLabel("Asia/Jayapura")).toBe("WIT");
    expect(timezoneLabel("Europe/London")).toBe("Europe/London");
  });
  it("validasi zona waktu", () => {
    expect(isValidTimezone("Asia/Jakarta")).toBe(true);
    expect(isValidTimezone("Bukan/Zona")).toBe(false);
    expect(isValidTimezone("  ")).toBe(false);
  });
});

describe("validateBranchForm", () => {
  const ok = () => ({ ...branchToFormValues(null), name: "Cabang Sudirman", code: "SDR-01" });
  it("form baru yang diisi nama & kode valid", () => {
    expect(validateBranchForm(ok())).toBeNull();
  });
  it("nama/kode wajib, error mengarah ke tab Profil", () => {
    expect(validateBranchForm({ ...ok(), name: " " })?.tab).toBe("profil");
    expect(validateBranchForm({ ...ok(), code: "" })?.tab).toBe("profil");
  });
  it("tarif di luar 0-100 ditolak di tab Pajak", () => {
    expect(validateBranchForm({ ...ok(), ppn_rate: 101 })?.tab).toBe("pajak");
    expect(validateBranchForm({ ...ok(), service_charge_rate: -1 })?.tab).toBe("pajak");
    expect(validateBranchForm({ ...ok(), ppn_rate: Number.NaN })?.tab).toBe("pajak");
  });
  it("nilai poin hanya divalidasi bila program poin aktif", () => {
    expect(validateBranchForm({ ...ok(), loyalty_spend_per_point: 0 })).toBeNull();
    expect(
      validateBranchForm({ ...ok(), loyalty_enabled: true, loyalty_spend_per_point: 0 })?.tab,
    ).toBe("pajak");
    expect(
      validateBranchForm({ ...ok(), loyalty_enabled: true, loyalty_point_value: 1.5 })?.tab,
    ).toBe("pajak");
  });
  it("pembulatan di luar pilihan ditolak", () => {
    expect(validateBranchForm({ ...ok(), rounding_step: 250 })?.tab).toBe("pajak");
    expect(validateBranchForm({ ...ok(), rounding_step: 500 })).toBeNull();
  });
});

describe("isMissingBranchColumnError", () => {
  it("mengenali error kolom 048 yang belum ada", () => {
    expect(isMissingBranchColumnError("column branches.timezone does not exist")).toBe(true);
    expect(isMissingBranchColumnError("column branches.loyalty_enabled does not exist")).toBe(true);
    expect(isMissingBranchColumnError('relation "e_pos.branches" does not exist')).toBe(false);
    expect(isMissingBranchColumnError(null)).toBe(false);
  });
});

const typed = (id: string, type: "pusat" | "cabang", over: Partial<Branch> = {}): Branch =>
  mk(id, { branch_type: type, has_type: true, ...over });

describe("jenis outlet (migration 053)", () => {
  it("normalizeBranch membaca branch_type dan menandai has_type", () => {
    const pusat = normalizeBranch({ id: "a", name: "A", branch_type: "pusat" });
    expect(pusat.branch_type).toBe("pusat");
    expect(pusat.has_type).toBe(true);
    const lama = normalizeBranch({ id: "b", name: "B" });
    expect(lama.branch_type).toBe("cabang");
    expect(lama.has_type).toBe(false);
  });

  it("nilai branch_type yang aneh dianggap cabang", () => {
    expect(normalizeBranch({ id: "a", name: "A", branch_type: "x" }).branch_type).toBe("cabang");
  });

  it("form outlet baru default cabang, form edit membawa jenis outlet", () => {
    expect(branchToFormValues(null).branch_type).toBe("cabang");
    expect(branchToFormValues(typed("a", "pusat")).branch_type).toBe("pusat");
  });

  it("kolom penuh memuat branch_type, kolom cadangan tidak", () => {
    expect(BRANCH_COLUMNS).toContain("branch_type");
    expect(BRANCH_COLUMNS_NO_TYPE).not.toContain("branch_type");
    expect(BRANCH_COLUMNS_NO_TYPE).toContain("timezone");
  });

  it("isMissingBranchTypeError hanya untuk kolom branch_type yang hilang", () => {
    expect(isMissingBranchTypeError("column branches.branch_type does not exist")).toBe(true);
    expect(isMissingBranchTypeError("Could not find the 'branch_type' column of 'branches' in the schema cache")).toBe(true);
    expect(isMissingBranchTypeError("column branches.timezone does not exist")).toBe(false);
    expect(isMissingBranchTypeError(null)).toBe(false);
  });

  const valid = () => ({ ...branchToFormValues(null), name: "Outlet Baru", code: "OB-1" });

  it("validateBranchForm menolak pusat kedua", () => {
    const branches = [typed("a", "pusat", { name: "Pusat Lama" }), typed("b", "cabang")];
    const res = validateBranchForm(
      { ...valid(), branch_type: "pusat" },
      { branches, editingId: "b" },
    );
    expect(res?.tab).toBe("profil");
    expect(res?.message).toContain("Pusat Lama");
  });

  it("validateBranchForm mengizinkan pusat yang sama diedit", () => {
    const branches = [typed("a", "pusat"), typed("b", "cabang")];
    expect(
      validateBranchForm({ ...valid(), branch_type: "pusat" }, { branches, editingId: "a" }),
    ).toBeNull();
  });

  it("validateBranchForm menolak pusat nonaktif", () => {
    const res = validateBranchForm({ ...valid(), branch_type: "pusat", is_active: false });
    expect(res?.message).toContain("tidak bisa dinonaktifkan");
  });

  it("validateBranchForm menolak jenis di luar pusat/cabang", () => {
    const res = validateBranchForm({ ...valid(), branch_type: "x" as never });
    expect(res?.tab).toBe("profil");
  });

  it("pusatBranch mengembalikan pusat atau null", () => {
    expect(pusatBranch([typed("a", "cabang"), typed("b", "pusat")])?.id).toBe("b");
    expect(pusatBranch([typed("a", "cabang")])).toBeNull();
  });

  it("outletRole: pusat, cabang, dan jenis belum dikenal", () => {
    expect(outletRole(typed("a", "pusat"))).toBe("pusat");
    expect(outletRole(typed("a", "cabang"))).toBe("cabang");
    expect(outletRole(mk("a"))).toBe("tanpa-pusat");
    expect(outletRole(null)).toBe("tanpa-pusat");
  });

  it("productTargetBranches: pusat memilih cabang aktif, cabang hanya dirinya", () => {
    const pusat = typed("p", "pusat");
    const c1 = typed("c1", "cabang");
    const c2 = typed("c2", "cabang", { is_active: false });
    const c3 = typed("c3", "cabang");
    const all = [pusat, c1, c2, c3];
    expect(productTargetBranches(pusat, all).map((b) => b.id)).toEqual(["c1", "c3"]);
    expect(productTargetBranches(c1, all).map((b) => b.id)).toEqual(["c1"]);
  });

  it("productTargetBranches: jenis belum dikenal memakai semua outlet aktif", () => {
    const a = mk("a");
    const b = mk("b", { is_active: false });
    expect(productTargetBranches(a, [a, b]).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("loyaltyRuleGroups", () => {
  const rule = (id: string, spend: number, value: number, over: Partial<Branch> = {}) =>
    mk(id, { loyalty_enabled: true, loyalty_spend_per_point: spend, loyalty_point_value: value, ...over });

  it("satu grup kalau semua outlet aktif memakai aturan yang sama", () => {
    const groups = loyaltyRuleGroups([rule("a", 10000, 100), rule("b", 10000, 100)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].branchNames).toEqual(["Cabang a", "Cabang b"]);
  });

  it("beberapa grup kalau aturan berbeda", () => {
    const groups = loyaltyRuleGroups([rule("a", 10000, 100), rule("b", 1000, 1000)]);
    expect(groups).toHaveLength(2);
  });

  it("mengabaikan outlet nonaktif dan outlet tanpa program poin", () => {
    const groups = loyaltyRuleGroups([
      rule("a", 10000, 100),
      rule("b", 1000, 1000, { is_active: false }),
      rule("c", 500, 500, { loyalty_enabled: false }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("kosong kalau tidak ada program poin yang menyala", () => {
    expect(loyaltyRuleGroups([rule("a", 10000, 100, { loyalty_enabled: false })])).toEqual([]);
  });
});
