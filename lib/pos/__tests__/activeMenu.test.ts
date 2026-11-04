import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VALID_MENU_KEYS,
  clearStoredMenu,
  readStoredMenu,
  saveActiveMenu,
} from "../activeMenu";

// sessionStorage tiruan; `broken` mensimulasikan mode privat / akses ditolak.
let store: Record<string, string>;
let broken: boolean;

beforeEach(() => {
  store = {};
  broken = false;
  const guard = () => {
    if (broken) throw new Error("SecurityError");
  };
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => (guard(), k in store ? store[k] : null),
      setItem: (k: string, v: string) => (guard(), void (store[k] = v)),
      removeItem: (k: string) => (guard(), void delete store[k]),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("activeMenu", () => {
  it("simpan lalu baca kembali", () => {
    saveActiveMenu("kasir");
    expect(readStoredMenu()).toBe("kasir");
  });

  it("belum ada yang tersimpan -> null", () => {
    expect(readStoredMenu()).toBeNull();
  });

  it("semua kunci menu valid bisa disimpan dan dibaca", () => {
    for (const key of VALID_MENU_KEYS) {
      saveActiveMenu(key);
      expect(readStoredMenu()).toBe(key);
    }
  });

  it("kunci tak dikenal diabaikan (jatuh ke Dashboard)", () => {
    saveActiveMenu("menu-yang-sudah-dihapus");
    expect(readStoredMenu()).toBeNull();
  });

  it("nilai kosong diabaikan", () => {
    saveActiveMenu("");
    expect(readStoredMenu()).toBeNull();
  });

  it("clearStoredMenu menghapus pilihan (login/logout selalu mulai dari awal)", () => {
    saveActiveMenu("laporan");
    clearStoredMenu();
    expect(readStoredMenu()).toBeNull();
  });

  it("tidak ada kunci ganda di daftar menu", () => {
    expect(new Set(VALID_MENU_KEYS).size).toBe(VALID_MENU_KEYS.length);
  });

  it("storage rusak/terblokir: tidak melempar error", () => {
    broken = true;
    expect(() => saveActiveMenu("kasir")).not.toThrow();
    expect(readStoredMenu()).toBeNull();
    expect(() => clearStoredMenu()).not.toThrow();
  });

  it("tanpa window sama sekali (server): aman", () => {
    vi.unstubAllGlobals();
    expect(readStoredMenu()).toBeNull();
    expect(() => saveActiveMenu("kasir")).not.toThrow();
    expect(() => clearStoredMenu()).not.toThrow();
  });
});
