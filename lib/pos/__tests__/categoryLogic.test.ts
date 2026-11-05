import { describe, expect, it } from "vitest";
import {
  CATEGORY_DELETE_ERROR_MESSAGE,
  categorySaveErrorMessage,
  validateCategoryInput,
} from "../categoryLogic";

describe("validateCategoryInput", () => {
  it("menerima input valid dan men-trim nama", () => {
    const r = validateCategoryInput({
      name: "  Kaos  ",
      sort_order: "3",
      is_active: true,
    });
    expect(r).toEqual({
      ok: true,
      value: { name: "Kaos", sort_order: 3, is_active: true },
    });
  });

  it("menolak nama kosong atau hanya spasi", () => {
    for (const name of ["", "   "]) {
      const r = validateCategoryInput({ name, sort_order: "0", is_active: true });
      expect(r).toEqual({ ok: false, message: "Nama kategori wajib diisi." });
    }
  });

  it("menolak urutan negatif, bukan angka, atau tak hingga", () => {
    for (const sort_order of ["-1", "abc", "Infinity"]) {
      const r = validateCategoryInput({ name: "A", sort_order, is_active: true });
      expect(r.ok).toBe(false);
    }
  });

  it("menerima urutan 0 dan mempertahankan is_active=false", () => {
    const r = validateCategoryInput({
      name: "A",
      sort_order: "0",
      is_active: false,
    });
    expect(r).toEqual({
      ok: true,
      value: { name: "A", sort_order: 0, is_active: false },
    });
  });
});

describe("categorySaveErrorMessage", () => {
  it("memetakan unique violation (23505) ke pesan nama duplikat", () => {
    expect(categorySaveErrorMessage({ code: "23505", message: "dup" })).toBe(
      "Kategori dengan nama tersebut sudah ada.",
    );
  });

  it("meneruskan pesan asli untuk error lain", () => {
    expect(categorySaveErrorMessage({ code: "42501", message: "denied" })).toBe(
      "denied",
    );
    expect(categorySaveErrorMessage({ message: "boom" })).toBe("boom");
  });
});

describe("CATEGORY_DELETE_ERROR_MESSAGE", () => {
  it("menyarankan menonaktifkan kategori", () => {
    expect(CATEGORY_DELETE_ERROR_MESSAGE).toContain("nonaktifkan");
  });
});
