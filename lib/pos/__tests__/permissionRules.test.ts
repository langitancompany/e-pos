import { describe, expect, it } from "vitest";
import {
  findPermissionEscalation,
  holdsPermission,
  permissionLabel,
  permissionsEqual,
} from "../permissionRules";
import { MODULE_DEFS } from "../permissionModules";

describe("permissionLabel", () => {
  it("memakai label modul yang dikenal", () => {
    const def = MODULE_DEFS[0];
    expect(permissionLabel(def.key, "edit")).toBe(`${def.label} · Ubah`);
  });

  it("jatuh ke nama mentah untuk modul/aksi tak dikenal", () => {
    expect(permissionLabel("modul_x", "aksi_y")).toBe("modul_x · aksi_y");
  });
});

describe("holdsPermission", () => {
  const perms = { produk: { view: true, edit: false } };

  it("hanya true murni yang dianggap punya izin", () => {
    expect(holdsPermission(perms, "produk", "view")).toBe(true);
    expect(holdsPermission(perms, "produk", "edit")).toBe(false);
  });

  it("fail-closed untuk modul/aksi hilang dan input tak valid", () => {
    expect(holdsPermission(perms, "produk", "delete")).toBe(false);
    expect(holdsPermission(perms, "kasir", "view")).toBe(false);
    expect(holdsPermission(null, "produk", "view")).toBe(false);
    expect(holdsPermission("bukan-objek", "produk", "view")).toBe(false);
    expect(holdsPermission({ produk: { view: "true" } }, "produk", "view")).toBe(false);
  });
});

describe("permissionsEqual", () => {
  it("aksi yang tidak tertulis dianggap false", () => {
    expect(
      permissionsEqual({ produk: { view: true, edit: false } }, { produk: { view: true } }),
    ).toBe(true);
  });

  it("mendeteksi perbedaan, termasuk modul yang hanya ada di satu sisi", () => {
    expect(permissionsEqual({ produk: { view: true } }, { produk: { view: false } })).toBe(false);
    expect(permissionsEqual({ produk: { view: true } }, {})).toBe(false);
    expect(permissionsEqual(null, undefined)).toBe(true);
  });
});

describe("findPermissionEscalation", () => {
  const caller = { produk: { view: true, edit: true }, kasir: { view: true } };

  it("null bila izin yang ditambah dimiliki si pemberi", () => {
    const current = { produk: { view: true } };
    const next = { produk: { view: true, edit: true } };
    expect(findPermissionEscalation(next, current, caller)).toBeNull();
  });

  it("mengembalikan label izin yang tidak dimiliki si pemberi", () => {
    const current = { produk: { view: true } };
    const next = { produk: { view: true, delete: true } };
    expect(findPermissionEscalation(next, current, caller)).toBe(
      permissionLabel("produk", "delete"),
    );
  });

  it("izin yang sudah dimiliki target (tidak berubah) tidak dihitung", () => {
    const current = { produk: { view: true, delete: true } };
    const next = { produk: { view: true, delete: true } };
    expect(findPermissionEscalation(next, current, caller)).toBeNull();
  });

  it("mengurangi atau mengosongkan izin selalu boleh", () => {
    const current = { produk: { view: true, edit: true, delete: true } };
    const next = { produk: { view: true, edit: false, delete: false } };
    expect(findPermissionEscalation(next, current, {})).toBeNull();
  });
});
