import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  ROLE_OPTIONS,
  getUserRoles,
  hasRole,
  isSuperAdmin,
  normalizeRoles,
  roleLabel,
} from "../roles";

describe("normalizeRoles", () => {
  it("membuang role tak dikenal dan duplikat", () => {
    expect(normalizeRoles(["kasir", "dewa", "kasir", "admin"])).toEqual([
      "admin",
      "kasir",
    ]);
  });

  it("urutan mengikuti ROLE_OPTIONS, bukan urutan input", () => {
    expect(normalizeRoles(["qc", "kasir", "super_admin"])).toEqual([
      "super_admin",
      "kasir",
      "qc",
    ]);
  });

  it("input bukan array -> daftar kosong", () => {
    expect(normalizeRoles(null)).toEqual([]);
    expect(normalizeRoles(undefined)).toEqual([]);
    expect(normalizeRoles("admin")).toEqual([]);
    expect(normalizeRoles({ 0: "admin" })).toEqual([]);
  });
});

describe("roleLabel", () => {
  it("memberi label untuk role yang dikenal", () => {
    expect(roleLabel("super_admin")).toBe("Super Admin");
    expect(roleLabel("qc")).toBe("QC");
  });

  it("role tak dikenal ditampilkan apa adanya", () => {
    expect(roleLabel("magang")).toBe("magang");
  });
});

describe("getUserRoles / hasRole / isSuperAdmin", () => {
  it("aman untuk user null, undefined, atau tanpa roles", () => {
    expect(getUserRoles(null)).toEqual([]);
    expect(getUserRoles(undefined)).toEqual([]);
    expect(getUserRoles({ roles: null })).toEqual([]);
    expect(getUserRoles({ roles: [] })).toEqual([]);
    expect(hasRole(null, "kasir")).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });

  it("mendeteksi role yang dimiliki (boleh banyak role)", () => {
    const user = { roles: ["kasir", "supervisor"] };
    expect(hasRole(user, "kasir")).toBe(true);
    expect(hasRole(user, "supervisor")).toBe(true);
    expect(hasRole(user, "admin")).toBe(false);
    expect(isSuperAdmin(user)).toBe(false);
  });

  it("super_admin dikenali", () => {
    expect(isSuperAdmin({ roles: ["admin", "super_admin"] })).toBe(true);
  });
});

describe("konstanta role", () => {
  it("role bawaan user baru adalah kasir dan termasuk daftar resmi", () => {
    expect(DEFAULT_ROLES).toEqual(["kasir"]);
    const values: string[] = ROLE_OPTIONS.map((o) => o.value);
    for (const role of DEFAULT_ROLES) expect(values).toContain(role);
  });

  it("nilai role unik", () => {
    const values = ROLE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
