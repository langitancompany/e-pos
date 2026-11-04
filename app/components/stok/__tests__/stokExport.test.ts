import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// xlsx dipakai ASLI supaya isi sheet benar-benar diperiksa; hanya writeFile
// yang diganti (tidak menulis file ke disk).
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

import * as XLSX from "xlsx";
import {
  exportMovementsToExcel,
  exportOpnameToExcel,
  exportStockToExcel,
} from "../stokExport";
import type { OpnameItem, OpnameSession } from "@/hooks/useOpname";
import type { StockMovement } from "@/hooks/useStock";
import type { ProductWithCategory } from "@/hooks/useProducts";

const NOW = new Date(2026, 10, 5, 9, 7);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(XLSX.writeFile).mockClear();
});
afterEach(() => vi.useRealTimers());

function written() {
  const call = vi.mocked(XLSX.writeFile).mock.calls[0];
  return { wb: call[0] as XLSX.WorkBook, fileName: call[1] as string };
}
const rows = (wb: XLSX.WorkBook, name: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null });
const cell = (wb: XLSX.WorkBook, sheet: string, addr: string) => wb.Sheets[sheet][addr];

// ───────────────────────── Opname ─────────────────────────

const session = (over: Partial<OpnameSession> = {}): OpnameSession =>
  ({
    id: "s1",
    number: 7,
    name: "Opname Akhir Bulan",
    category_id: null,
    category_name: null,
    status: "completed",
    note: null,
    created_by: "u1",
    created_at: "2026-11-01T01:00:00Z",
    finalized_by: "u1",
    finalized_at: "2026-11-02T01:00:00Z",
    created_by_name: "Sari",
    ...over,
  }) as OpnameSession;

const opItem = (over: Partial<OpnameItem> = {}): OpnameItem => ({
  id: "i1",
  session_id: "s1",
  product_id: "p1",
  product_name: "Kaos",
  product_sku: "KP-1",
  product_barcode: "899",
  product_unit: "pcs",
  cost_price: 20_000,
  system_qty: 10,
  counted_qty: 8,
  note: "rusak 2",
  counted_at: "2026-11-01T02:00:00Z",
  applied_delta: -2,
  ...over,
});

describe("exportOpnameToExcel", () => {
  it("2 sheet (Ringkasan, Detail), nama file memuat nomor sesi dan waktu", () => {
    exportOpnameToExcel(session(), [opItem()]);
    const { wb, fileName } = written();
    expect(wb.SheetNames).toEqual(["Ringkasan", "Detail"]);
    expect(fileName).toBe("Opname-7_2026-11-05_0907.xlsx");
  });

  it("Ringkasan: metadata sesi", () => {
    exportOpnameToExcel(session({ note: "dihitung ulang" }), [opItem()]);
    const r = rows(written().wb, "Ringkasan");
    expect(r[0]).toEqual(["Opname #7", "Opname Akhir Bulan"]);
    expect(r[1]).toEqual(["Status", "Selesai"]);
    expect(r[2]).toEqual(["Cakupan", "Semua produk berstok"]);
    expect(r[4]).toEqual(["Dibuat oleh", "Sari"]);
    expect(r[6]).toEqual(["Catatan", "dihitung ulang"]);
  });

  it("Ringkasan: cakupan kategori, penulis kosong, belum diselesaikan", () => {
    exportOpnameToExcel(
      session({ category_name: "Kaos", created_by_name: null, finalized_at: null, status: "draft" }),
      [],
    );
    const r = rows(written().wb, "Ringkasan");
    expect(r[1]).toEqual(["Status", "Berjalan"]);
    expect(r[2]).toEqual(["Cakupan", "Kaos"]);
    expect(r[4]).toEqual(["Dibuat oleh", "-"]);
    expect(r[5]).toEqual(["Diselesaikan", "-"]);
    expect(r[6]).toEqual(["Catatan", "-"]);
  });

  it("Ringkasan: statistik dari computeOpnameStats", () => {
    exportOpnameToExcel(session(), [
      opItem({ counted_qty: 10 }), // cocok
      opItem({ id: "i2", counted_qty: 13, cost_price: 1_000 }), // +3
      opItem({ id: "i3", counted_qty: 8, cost_price: 20_000 }), // -2 => -40.000
      opItem({ id: "i4", counted_qty: null }), // belum
    ]);
    const stats = Object.fromEntries(
      rows(written().wb, "Ringkasan")
        .slice(9)
        .map((r) => [r[0], r[1]]),
    );
    expect(stats["Total produk"]).toBe(4);
    expect(stats["Sudah dihitung"]).toBe(3);
    expect(stats["Belum dihitung"]).toBe(1);
    expect(stats["Cocok dengan stok sistem"]).toBe(1);
    expect(stats["Ada selisih"]).toBe(2);
    expect(stats["Stok lebih (unit)"]).toBe(3);
    expect(stats["Stok kurang (unit)"]).toBe(2);
    expect(stats["Selisih nilai (Rp, harga modal)"]).toBe(3_000 - 40_000);
  });

  it("Detail: header, nomor urut, selisih dan nilai selisih", () => {
    exportOpnameToExcel(session(), [opItem()]);
    const r = rows(written().wb, "Detail");
    expect(r[0]).toEqual([
      "No", "SKU", "Barcode", "Produk", "Satuan", "Stok Sistem", "Hitung Fisik",
      "Selisih", "Harga Modal", "Nilai Selisih", "Catatan", "Diterapkan ke Stok",
    ]);
    expect(r[1]).toEqual([1, "KP-1", "899", "Kaos", "pcs", 10, 8, -2, 20_000, -40_000, "rusak 2", -2]);
  });

  it("Detail: item belum dihitung -> selisih & nilai kosong; harga modal kosong -> nilai kosong", () => {
    exportOpnameToExcel(session(), [
      opItem({ counted_qty: null, applied_delta: null }),
      opItem({ id: "i2", cost_price: null }),
    ]);
    const r = rows(written().wb, "Detail");
    expect(r[1].slice(6, 10)).toEqual([null, null, 20_000, null]);
    expect(r[2].slice(7, 10)).toEqual([-2, null, null]);
  });

  it("Detail: SKU/barcode/satuan/catatan kosong jadi teks kosong", () => {
    exportOpnameToExcel(
      session(),
      [opItem({ product_sku: null, product_barcode: null, product_unit: null, note: null })],
    );
    const r = rows(written().wb, "Detail")[1];
    // sel string kosong dibaca sebagai "" atau null tergantung pustaka; keduanya = kosong
    for (const i of [1, 2, 4, 10]) expect(r[i] === "" || r[i] === null).toBe(true);
  });

  it("Detail: kolom angka berformat ribuan, kolom teks tidak", () => {
    exportOpnameToExcel(session(), [opItem()]);
    const { wb } = written();
    expect(cell(wb, "Detail", "F2").z).toBe("#,##0"); // Stok Sistem
    expect(cell(wb, "Detail", "I2").z).toBe("#,##0"); // Harga Modal
    expect(cell(wb, "Detail", "J2").z).toBe("#,##0"); // Nilai Selisih
    expect(cell(wb, "Detail", "A2").z).toBeUndefined(); // No
  });

  it("tanpa item: tetap menulis file dengan header saja", () => {
    exportOpnameToExcel(session(), []);
    expect(rows(written().wb, "Detail")).toHaveLength(1);
  });
});

// ───────────────────────── Stok saat ini ─────────────────────────

const prod = (over: Partial<ProductWithCategory> = {}): ProductWithCategory =>
  ({
    id: "p1",
    sku: "KP-1",
    barcode: "899",
    name: "Kaos",
    unit: "pcs",
    stock: 20,
    min_stock: 5,
    cost_price: 30_000,
    category: { name: "Pakaian" },
    ...over,
  }) as ProductWithCategory;

describe("exportStockToExcel", () => {
  it("1 sheet 'Stok', nama file bertanggal", () => {
    exportStockToExcel([prod()]);
    const { wb, fileName } = written();
    expect(wb.SheetNames).toEqual(["Stok"]);
    expect(fileName).toBe("Stok_2026-11-05_0907.xlsx");
  });

  it("baris produk: status dan nilai persediaan", () => {
    exportStockToExcel([
      prod(),
      prod({ id: "p2", name: "Stiker", stock: 5, min_stock: 5 }),
      prod({ id: "p3", name: "Topi", stock: 0 }),
    ]);
    const r = rows(written().wb, "Stok");
    expect(r[0]).toEqual([
      "No", "SKU", "Barcode", "Produk", "Kategori", "Satuan", "Stok",
      "Stok Minimum", "Status", "Harga Modal", "Nilai Persediaan",
    ]);
    expect(r[1]).toEqual([1, "KP-1", "899", "Kaos", "Pakaian", "pcs", 20, 5, "Aman", 30_000, 600_000]);
    expect(r[2][8]).toBe("Menipis");
    expect(r[3][8]).toBe("Habis");
    expect(r[3][10]).toBe(0);
  });

  it("stok negatif tidak mengurangi nilai persediaan (dibatasi 0)", () => {
    exportStockToExcel([prod({ stock: -4 })]);
    const r = rows(written().wb, "Stok")[1];
    expect(r[8]).toBe("Habis");
    expect(r[10]).toBe(0);
  });

  it("harga modal kosong -> nilai persediaan kosong (bukan 0)", () => {
    exportStockToExcel([prod({ cost_price: null })]);
    const r = rows(written().wb, "Stok")[1];
    expect(r[9]).toBeNull();
    expect(r[10]).toBeNull();
  });

  it("kategori kosong -> teks kosong; kolom angka berformat ribuan", () => {
    exportStockToExcel([prod({ category: null })]);
    const { wb } = written();
    const r = rows(wb, "Stok")[1];
    expect(r[4] === "" || r[4] === null).toBe(true);
    expect(cell(wb, "Stok", "K2").z).toBe("#,##0");
    expect(cell(wb, "Stok", "G2").z).toBe("#,##0");
  });
});

// ───────────────────────── Riwayat mutasi ─────────────────────────

const mv = (over: Partial<StockMovement> = {}): StockMovement => ({
  id: "m1",
  product_id: "p1",
  type: "sale",
  qty_delta: -2,
  reference_id: null,
  reason: null,
  created_by: "u1",
  created_at: "2026-11-04T05:00:00Z",
  product_name: "Kaos",
  product_sku: "KP-1",
  product_unit: "pcs",
  stock_after: 8,
  stock_before: 10,
  created_by_name: "Sari",
  ...over,
});

const meta = (over: Partial<Parameters<typeof exportMovementsToExcel>[1]> = {}) => ({
  filterLines: [["Jenis", "Semua"]] as [string, string][],
  truncated: false,
  typeLabels: { sale: "Penjualan", stock_in: "Barang Masuk" },
  ...over,
});

describe("exportMovementsToExcel", () => {
  it("2 sheet (Ringkasan, Mutasi), nama file bertanggal", () => {
    exportMovementsToExcel([mv()], meta());
    const { wb, fileName } = written();
    expect(wb.SheetNames).toEqual(["Ringkasan", "Mutasi"]);
    expect(fileName).toBe("Riwayat-Mutasi_2026-11-05_0907.xlsx");
  });

  it("Ringkasan: filter aktif, jumlah mutasi, stok masuk/keluar", () => {
    exportMovementsToExcel(
      [mv({ qty_delta: 10 }), mv({ id: "m2", qty_delta: -3 }), mv({ id: "m3", qty_delta: -2 }), mv({ id: "m4", qty_delta: 0 })],
      meta(),
    );
    const r = rows(written().wb, "Ringkasan");
    expect(r[0][0]).toBe("Riwayat Mutasi Stok");
    expect(r.some((x) => x[0] === "Jenis" && x[1] === "Semua")).toBe(true);
    const by = Object.fromEntries(r.filter((x) => x.length >= 2).map((x) => [x[0], x[1]]));
    expect(by["Jumlah mutasi"]).toBe(4);
    expect(by["Stok masuk (unit)"]).toBe(10);
    expect(by["Stok keluar (unit)"]).toBe(5);
  });

  it("catatan pemotongan hanya muncul bila data melebihi batas ekspor", () => {
    exportMovementsToExcel([mv()], meta({ truncated: false }));
    expect(rows(written().wb, "Ringkasan").some((r) => r[0] === "Catatan")).toBe(false);

    vi.mocked(XLSX.writeFile).mockClear();
    exportMovementsToExcel([mv()], meta({ truncated: true }));
    const note = rows(written().wb, "Ringkasan").find((r) => r[0] === "Catatan");
    expect(String(note?.[1])).toMatch(/Persempit filter/);
  });

  it("Mutasi: label jenis dari pemanggil, fallback ke kode jenis", () => {
    exportMovementsToExcel([mv(), mv({ id: "m2", type: "gift" })], meta());
    const r = rows(written().wb, "Mutasi");
    expect(r[0]).toEqual(["No", "Waktu", "Produk", "SKU", "Jenis", "Qty", "Stok Sebelum", "Stok Sesudah", "Alasan", "Oleh"]);
    expect(r[1][4]).toBe("Penjualan");
    expect(r[2][4]).toBe("gift"); // tidak ada label -> kode apa adanya
  });

  it("Mutasi: kolom waktu berupa tanggal sungguhan dengan format dd/mm/yyyy hh:mm", () => {
    exportMovementsToExcel([mv()], meta());
    const { wb } = written();
    const c = cell(wb, "Mutasi", "B2");
    expect(c.t).toBe("d");
    expect(c.z).toBe("dd/mm/yyyy hh:mm");
    expect((c.v as Date).toISOString()).toBe("2026-11-04T05:00:00.000Z");
  });

  it("Mutasi: produk yang sudah dihapus permanen", () => {
    exportMovementsToExcel(
      [mv({ product_name: null, product_sku: null, stock_before: null, stock_after: null, created_by_name: null })],
      meta(),
    );
    const r = rows(written().wb, "Mutasi")[1];
    expect(r[2]).toBe("Produk dihapus");
    expect(r[6]).toBeNull();
    expect(r[7]).toBeNull();
  });

  it("Mutasi: kolom Qty/Stok berformat ribuan", () => {
    exportMovementsToExcel([mv({ qty_delta: -1500, stock_before: 2000, stock_after: 500 })], meta());
    const { wb } = written();
    for (const addr of ["F2", "G2", "H2"]) expect(cell(wb, "Mutasi", addr).z).toBe("#,##0");
  });

  it("tanpa data: tetap menulis file (header saja, ringkasan nol)", () => {
    exportMovementsToExcel([], meta());
    const { wb } = written();
    expect(rows(wb, "Mutasi")).toHaveLength(1);
    const by = Object.fromEntries(rows(wb, "Ringkasan").filter((x) => x.length >= 2).map((x) => [x[0], x[1]]));
    expect(by["Jumlah mutasi"]).toBe(0);
  });
});
