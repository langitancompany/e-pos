import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSIONS,
  MODULE_DEFS,
  MODULE_KEYS,
  defOf,
  getField,
  grantModules,
  grantedModules,
  moduleHasAccess,
  resolvePermissions,
  revokeModule,
  sanitizePermissions,
  setField,
  summarizeAccess,
  type UserPermissions,
} from "../permissionModules";

const none = { create: false, edit: false, delete: false };
const all = { create: true, edit: true, delete: true };

describe("definisi modul", () => {
  it("kunci modul unik dan MODULE_KEYS cocok dengan MODULE_DEFS", () => {
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length);
    expect(MODULE_KEYS).toEqual(MODULE_DEFS.map((d) => d.key));
  });

  it("defOf menemukan modul, dan undefined untuk kunci asing", () => {
    expect(defOf("produk")?.label).toBe("Kelola Produk");
    expect(defOf("tidak-ada")).toBeUndefined();
  });
});

describe("DEFAULT_PERMISSIONS", () => {
  it("hanya modul Kasir yang bisa dilihat; semua izin lain mati", () => {
    for (const [key, perm] of Object.entries(DEFAULT_PERMISSIONS)) {
      for (const [field, value] of Object.entries(perm)) {
        expect(value, `${key}.${field}`).toBe(key === "kasir" && field === "view");
      }
    }
  });

  it("field tiap modul sesuai kolom yang tersedia", () => {
    expect(Object.keys(DEFAULT_PERMISSIONS.produk).sort()).toEqual(["create", "delete", "edit", "view"]);
    expect(Object.keys(DEFAULT_PERMISSIONS.laporan)).toEqual(["view"]);
    expect(Object.keys(DEFAULT_PERMISSIONS.kasir).sort()).toEqual(["lintas_kasir", "view"]);
    expect(Object.keys(DEFAULT_PERMISSIONS.stok).sort()).toEqual(["edit", "view"]);
  });
});

describe("resolvePermissions", () => {
  it("data kosong/bukan objek -> izin bawaan", () => {
    expect(resolvePermissions(undefined)).toEqual(DEFAULT_PERMISSIONS);
    expect(resolvePermissions(null)).toEqual(DEFAULT_PERMISSIONS);
    expect(resolvePermissions("rusak")).toEqual(DEFAULT_PERMISSIONS);
  });

  it("menerapkan nilai boolean yang valid", () => {
    const result = resolvePermissions({ produk: { view: true, edit: true } });
    expect(result.produk).toEqual({ view: true, create: false, edit: true, delete: false });
  });

  it("mengabaikan nilai bukan boolean dan kunci asing", () => {
    const result = resolvePermissions({
      produk: { view: "true", edit: 1, hapusSemua: true },
      modulHantu: { view: true },
    });
    expect(result.produk.view).toBe(false);
    expect(result.produk.edit).toBe(false);
    expect(result.produk).not.toHaveProperty("hapusSemua");
    expect(result).not.toHaveProperty("modulHantu");
  });

  it("modul yang belum tersimpan ikut mendapat nilai bawaan (user lama)", () => {
    const result = resolvePermissions({ kasir: { view: false } });
    expect(Object.keys(result)).toEqual(MODULE_KEYS);
    expect(result.kasir.view).toBe(false);
  });
});

describe("sanitizePermissions", () => {
  it("menyalakan view otomatis bila ada aksi lain yang aktif", () => {
    const result = sanitizePermissions({ produk: { view: false, delete: true } });
    expect(result.produk.view).toBe(true);
    expect(result.produk.delete).toBe(true);
  });

  it("tidak menyalakan view bila semua aksi mati", () => {
    expect(sanitizePermissions({ produk: { view: false } }).produk.view).toBe(false);
  });

  it("lintas_kasir juga memaksa view Kasir menyala", () => {
    const result = sanitizePermissions({ kasir: { view: false, lintas_kasir: true } });
    expect(result.kasir.view).toBe(true);
  });
});

describe("getField / moduleHasAccess / grantedModules / summarizeAccess", () => {
  const perms = resolvePermissions({ produk: { view: true }, laporan: { view: true } });

  it("getField aman untuk modul/field yang tidak ada", () => {
    expect(getField(perms, "produk", "view")).toBe(true);
    expect(getField(perms, "produk", "edit")).toBe(false);
    expect(getField(perms, "modulHantu", "view")).toBe(false);
  });

  it("modul punya akses bila ada satu izin aktif", () => {
    expect(moduleHasAccess(perms, "produk")).toBe(true);
    expect(moduleHasAccess(perms, "pelanggan")).toBe(false);
    expect(moduleHasAccess(perms, "modulHantu")).toBe(false);
  });

  it("grantedModules dan summarizeAccess mengikuti urutan definisi modul", () => {
    expect(grantedModules(perms).map((d) => d.key)).toEqual(["kasir", "produk", "laporan"]);
    expect(summarizeAccess(perms)).toEqual([
      { label: "Kasir" },
      { label: "Kelola Produk" },
      { label: "Laporan" },
    ]);
  });
});

describe("setField", () => {
  const base = DEFAULT_PERMISSIONS as UserPermissions;

  it("menyalakan aksi juga menyalakan view modulnya", () => {
    const next = setField(base, "produk", "edit", true);
    expect(getField(next, "produk", "edit")).toBe(true);
    expect(getField(next, "produk", "view")).toBe(true);
  });

  it("tidak mengubah objek asli (immutable)", () => {
    setField(base, "produk", "edit", true);
    expect(getField(base, "produk", "edit")).toBe(false);
  });

  it("mematikan aksi tidak ikut mematikan atau menyalakan view", () => {
    const on = setField(base, "produk", "edit", true);
    const off = setField(on, "produk", "edit", false);
    expect(getField(off, "produk", "edit")).toBe(false);
    expect(getField(off, "produk", "view")).toBe(true);
  });

  it("view tidak dinyalakan bila canGrant melarangnya", () => {
    const canGrant = (_key: string, field: string) => field !== "view";
    const next = setField(base, "produk", "edit", true, canGrant);
    expect(getField(next, "produk", "edit")).toBe(true);
    expect(getField(next, "produk", "view")).toBe(false);
  });
});

describe("revokeModule", () => {
  it("mematikan semua izin satu modul tanpa menyentuh modul lain", () => {
    const granted = grantModules(DEFAULT_PERMISSIONS as UserPermissions, ["produk"], all);
    const revoked = revokeModule(granted, "produk");
    expect(Object.values(revoked.produk).every((v) => v === false)).toBe(true);
    expect(revoked.kasir.view).toBe(true);
  });

  it("modul Kasir ikut mematikan lintas_kasir", () => {
    const withExtra = setField(DEFAULT_PERMISSIONS as UserPermissions, "kasir", "lintas_kasir", true);
    const revoked = revokeModule(withExtra, "kasir");
    expect(revoked.kasir).toEqual({ view: false, lintas_kasir: false });
  });
});

describe("grantModules", () => {
  const empty = revokeModule(DEFAULT_PERMISSIONS as UserPermissions, "kasir");

  it("menyalakan view + izin awal yang memang ada di kolom modul", () => {
    const next = grantModules(empty, ["produk", "stok"], { create: true, edit: true, delete: false });
    expect(next.produk).toEqual({ view: true, create: true, edit: true, delete: false });
    // Stok hanya punya kolom edit
    expect(next.stok).toEqual({ view: true, edit: true });
  });

  it("izin awal yang tidak ada kolomnya tidak dibuat (Retur & Void tanpa edit)", () => {
    const next = grantModules(empty, ["retur_void"], all);
    expect(next.retur_void).toEqual({ view: true, create: true, delete: true });
    expect(getField(next, "retur_void", "edit")).toBe(false);
  });

  it("modul tanpa kolom aksi hanya mendapat view", () => {
    const next = grantModules(empty, ["laporan"], all);
    expect(next.laporan).toEqual({ view: true });
  });

  it("kunci tak dikenal dilewati", () => {
    const next = grantModules(empty, ["modulHantu"], all);
    expect(next).toEqual(empty);
  });

  it("canGrant: modul dilewati bila view-nya tidak boleh diberikan", () => {
    const canGrant = (key: string) => key !== "produk";
    const next = grantModules(empty, ["produk", "pelanggan"], all, canGrant);
    expect(moduleHasAccess(next, "produk")).toBe(false);
    expect(getField(next, "pelanggan", "view")).toBe(true);
  });

  it("canGrant: izin tertentu dilewati tetapi view tetap diberikan", () => {
    const canGrant = (_key: string, field: string) => field !== "delete";
    const next = grantModules(empty, ["produk"], all, canGrant);
    expect(next.produk).toEqual({ view: true, create: true, edit: true, delete: false });
  });

  it("izin awal kosong -> hanya view", () => {
    const next = grantModules(empty, ["produk"], none);
    expect(next.produk).toEqual({ view: true, create: false, edit: false, delete: false });
  });
});
