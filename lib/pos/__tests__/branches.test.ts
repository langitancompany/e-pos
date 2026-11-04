import { describe, expect, it } from "vitest";
import {
  branchFilter,
  branchName,
  canAccessBranch,
  resolveActiveBranchId,
  type Branch,
} from "../branches";

const mk = (id: string, over: Partial<Branch> = {}): Branch => ({
  id,
  name: `Cabang ${id}`,
  code: null,
  address: null,
  phone: null,
  is_active: true,
  sort_order: 0,
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
