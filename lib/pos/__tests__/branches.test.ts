import { describe, expect, it } from "vitest";
import {
  branchFilter,
  branchName,
  branchSettingsOverlay,
  branchToFormValues,
  canAccessBranch,
  isMissingBranchColumnError,
  isValidTimezone,
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
