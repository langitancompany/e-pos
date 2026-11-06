import { describe, expect, it } from "vitest";
import {
  NO_CATEGORY_FILTER,
  countByCategory,
  filterExpenses,
  formatLongDate,
  formatPeriodLabel,
  presetToDateKeys,
  summarizeExpenses,
  validateCategoryName,
  validateExpenseForm,
  type ExpenseRecord,
} from "../expenseLogic";

function row(partial: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id: "x",
    branch_id: null,
    category_id: null,
    category_name: null,
    spent_at: "2026-11-02",
    amount: 1000,
    description: "tes",
    created_by_name: null,
    created_at: "2026-11-02T01:00:00Z",
    ...partial,
  };
}

describe("presetToDateKeys", () => {
  const now = new Date(2026, 10, 6);

  it("bulan ini: tanggal 1 sampai akhir bulan", () => {
    expect(presetToDateKeys("this_month", now)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("hari ini: satu tanggal", () => {
    expect(presetToDateKeys("today", now)).toEqual({
      from: "2026-11-06",
      to: "2026-11-06",
    });
  });

  it("7 hari: enam hari ke belakang sampai hari ini", () => {
    expect(presetToDateKeys("7d", now)).toEqual({
      from: "2026-10-31",
      to: "2026-11-06",
    });
  });

  it("bulan lalu melewati pergantian tahun", () => {
    expect(presetToDateKeys("last_month", new Date(2026, 0, 15))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("semua: tanpa batas", () => {
    expect(presetToDateKeys("all", now)).toEqual({ from: "", to: "" });
  });
});

describe("format tanggal", () => {
  it("tanggal polos tidak bergeser zona waktu", () => {
    expect(formatLongDate("2026-11-02")).toBe("2 November 2026");
  });

  it("kosong atau rusak jadi tanda strip", () => {
    expect(formatLongDate(null)).toBe("-");
    expect(formatLongDate("abc")).toBe("-");
  });

  it("label periode", () => {
    expect(formatPeriodLabel({ from: "", to: "" })).toBe("Semua periode");
    expect(formatPeriodLabel({ from: "2026-11-01", to: "2026-11-30" })).toBe(
      "1 November 2026 s/d 30 November 2026",
    );
    expect(formatPeriodLabel({ from: "2026-11-01", to: "" })).toBe(
      "Sejak 1 November 2026",
    );
  });
});

describe("countByCategory", () => {
  it("menghitung per kategori, tanpa kategori, dan total", () => {
    const counts = countByCategory([
      row({ id: "a", category_id: "c1" }),
      row({ id: "b", category_id: "c1" }),
      row({ id: "c", category_id: "c2" }),
      row({ id: "d", category_id: null }),
    ]);
    expect(counts).toEqual({ all: 4, uncategorized: 1, byId: { c1: 2, c2: 1 } });
  });

  it("daftar kosong menghasilkan nol dan peta kosong", () => {
    expect(countByCategory([])).toEqual({ all: 0, uncategorized: 0, byId: {} });
  });
});

describe("filterExpenses", () => {
  const rows = [
    row({
      id: "a",
      category_id: "c1",
      category_name: "Gaji Pegawai",
      amount: 10000,
      description: "Gaji",
      created_by_name: "Budi",
    }),
    row({
      id: "b",
      category_id: null,
      amount: 25000,
      description: "Beli token listrik",
    }),
  ];

  it("tanpa filter mengembalikan semua", () => {
    expect(filterExpenses(rows, { search: "", categoryId: "" })).toHaveLength(2);
  });

  it("cari di keterangan, kategori, dan nama staf", () => {
    expect(filterExpenses(rows, { search: "token", categoryId: "" })).toHaveLength(1);
    expect(filterExpenses(rows, { search: "gaji pegawai", categoryId: "" })).toHaveLength(1);
    expect(filterExpenses(rows, { search: "budi", categoryId: "" })).toHaveLength(1);
  });

  it("cari nominal, abaikan titik pemisah ribuan", () => {
    const found = filterExpenses(rows, { search: "25.000", categoryId: "" });
    expect(found.map((r) => r.id)).toEqual(["b"]);
  });

  it("filter kategori dan tanpa kategori", () => {
    expect(filterExpenses(rows, { search: "", categoryId: "c1" }).map((r) => r.id)).toEqual(["a"]);
    expect(
      filterExpenses(rows, { search: "", categoryId: NO_CATEGORY_FILTER }).map((r) => r.id),
    ).toEqual(["b"]);
  });
});

describe("summarizeExpenses", () => {
  it("daftar kosong: semua nol dan tanpa kategori terbesar", () => {
    expect(summarizeExpenses([])).toEqual({
      total: 0,
      count: 0,
      average: 0,
      topCategory: null,
    });
  });

  it("total, rata-rata dibulatkan, dan kategori terbesar", () => {
    const summary = summarizeExpenses([
      row({ category_name: "Listrik", amount: 10000 }),
      row({ category_name: "Gaji", amount: 30000 }),
      row({ category_name: "Gaji", amount: 5001 }),
    ]);
    expect(summary.total).toBe(45001);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(15000);
    expect(summary.topCategory).toEqual({ name: "Gaji", total: 35001 });
  });

  it("seri total: nama yang lebih awal secara abjad menang", () => {
    const summary = summarizeExpenses([
      row({ category_name: "Transportasi", amount: 5000 }),
      row({ category_name: "Listrik", amount: 5000 }),
    ]);
    expect(summary.topCategory?.name).toBe("Listrik");
  });

  it("pengeluaran tanpa kategori dikelompokkan sendiri", () => {
    const summary = summarizeExpenses([row({ amount: 7000 })]);
    expect(summary.topCategory).toEqual({ name: "Tanpa kategori", total: 7000 });
  });
});

describe("validateExpenseForm", () => {
  const today = "2026-11-06";

  it("isian valid dirapikan", () => {
    const result = validateExpenseForm(
      { spentAt: "2026-11-05", amountDigits: "50000", description: "  Sabun  " },
      today,
    );
    expect(result).toEqual({
      ok: true,
      value: { spentAt: "2026-11-05", amount: 50000, description: "Sabun" },
    });
  });

  it("semua kolom kosong menghasilkan tiga pesan", () => {
    const result = validateExpenseForm(
      { spentAt: "", amountDigits: "", description: " " },
      today,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["amountDigits", "description", "spentAt"]);
  });

  it("tanggal masa depan ditolak", () => {
    const result = validateExpenseForm(
      { spentAt: "2026-11-07", amountDigits: "1000", description: "x" },
      today,
    );
    expect(result.ok).toBe(false);
  });

  it("nominal nol atau terlalu besar ditolak", () => {
    expect(validateExpenseForm({ spentAt: today, amountDigits: "0", description: "x" }, today).ok).toBe(false);
    expect(
      validateExpenseForm({ spentAt: today, amountDigits: "1000000000000", description: "x" }, today).ok,
    ).toBe(false);
  });
});

describe("validateCategoryName", () => {
  const existing = [
    { id: "1", name: "Listrik", is_active: true },
    { id: "2", name: "Gaji", is_active: false },
  ];

  it("terlalu pendek", () => {
    expect(validateCategoryName(" a ", existing, null)).toMatch(/minimal 2/);
  });

  it("nama kembar tanpa membedakan huruf besar kecil", () => {
    expect(validateCategoryName("listrik", existing, null)).toMatch(/sudah ada/);
  });

  it("mengubah kategori sendiri dengan nama yang sama tidak dianggap kembar", () => {
    expect(validateCategoryName("Listrik", existing, "1")).toBeNull();
  });

  it("nama baru lolos", () => {
    expect(validateCategoryName("Transportasi", existing, null)).toBeNull();
  });
});
