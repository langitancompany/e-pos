import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  buildProductTemplateSheets,
  parseProductSheet,
  parseWholeNumber,
  summarizeImport,
  type ImportContext,
} from "../productImport";
import { isEan13 } from "../productBarcode";

const HEADER = [
  "Nama Produk*",
  "SKU*",
  "Barcode",
  "Jenis Produk*",
  "Kategori",
  "Satuan",
  "Harga Jual*",
  "Harga Modal",
  "Stok Awal",
  "Minimum Stok",
  "Status",
];

const ctx = (patch: Partial<ImportContext> = {}): ImportContext => ({
  categories: [
    { id: "c1", name: "Pakaian" },
    { id: "c2", name: "Aksesoris" },
  ],
  existingSkus: new Set(),
  existingBarcodes: new Set(),
  ...patch,
});

const row = (patch: Partial<Record<number, string>> = {}): string[] => {
  const base = ["Kaos Polos", "kp-1", "", "FASHION", "Pakaian", "pcs", "75000", "40000", "10", "2", "Aktif"];
  return base.map((value, i) => patch[i] ?? value);
};

function parse(rows: string[][], context = ctx()) {
  const result = parseProductSheet([HEADER, ...rows], context);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}

describe("parseWholeNumber", () => {
  it("menerima angka polos, pemisah ribuan, Rp, dan nol desimal", () => {
    expect(parseWholeNumber("15000")).toBe(15000);
    expect(parseWholeNumber("15.000")).toBe(15000);
    expect(parseWholeNumber("1.500.000")).toBe(1500000);
    expect(parseWholeNumber("1,500,000")).toBe(1500000);
    expect(parseWholeNumber("Rp 15.000")).toBe(15000);
    expect(parseWholeNumber("15000.00")).toBe(15000);
    expect(parseWholeNumber("0")).toBe(0);
  });

  it("menolak pecahan, negatif, huruf, dan kosong", () => {
    expect(parseWholeNumber("15000.5")).toBeNull();
    expect(parseWholeNumber("-5")).toBeNull();
    expect(parseWholeNumber("abc")).toBeNull();
    expect(parseWholeNumber("")).toBeNull();
  });
});

describe("parseProductSheet: struktur file", () => {
  it("menolak file tanpa baris judul", () => {
    const result = parseProductSheet([["a", "b"], ["1", "2"]], ctx());
    expect(result).toMatchObject({ ok: false });
  });

  it("menyebut kolom wajib yang hilang", () => {
    const result = parseProductSheet([["Nama Produk*", "SKU*", "Barcode"], ["x", "y", ""]], ctx());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("Jenis Produk");
    expect((result as { error: string }).error).toContain("Harga Jual");
  });

  it("menolak file tanpa data dan file melebihi batas baris", () => {
    expect(parseProductSheet([HEADER], ctx())).toMatchObject({ ok: false });
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row({ 1: `SKU-${i}` }));
    expect(parseProductSheet([HEADER, ...many], ctx())).toMatchObject({ ok: false });
  });

  it("kolom boleh berbeda urutan dan baris kosong dilewati", () => {
    const rows = parseProductSheet(
      [
        ["Harga Jual", "SKU", "Nama", "Jenis"],
        [],
        ["5000", "a-1", "Pulpen", "merchandise"],
      ],
      ctx(),
    );
    expect(rows.ok && rows.rows).toHaveLength(1);
    const product = rows.ok ? rows.rows[0].product : null;
    expect(product).toMatchObject({ name: "Pulpen", sku: "A-1", type: "MERCHANDISE", sellPrice: 5000 });
  });
});

describe("parseProductSheet: validasi baris", () => {
  it("baris valid menghasilkan produk dengan nilai dirapikan", () => {
    const [first] = parse([row()]);
    expect(first.errors).toEqual([]);
    expect(first.rowNumber).toBe(2);
    expect(first.product).toMatchObject({
      name: "Kaos Polos",
      sku: "KP-1",
      type: "FASHION",
      categoryId: "c1",
      unit: "pcs",
      sellPrice: 75000,
      costPrice: 40000,
      stock: 10,
      minStock: 2,
      isActive: true,
    });
  });

  it("kategori dicocokkan tanpa membedakan huruf besar kecil, kategori asing ditolak", () => {
    expect(parse([row({ 4: "aksesoris" })])[0].product?.categoryId).toBe("c2");
    const bad = parse([row({ 4: "Elektronik" })])[0];
    expect(bad.product).toBeNull();
    expect(bad.errors[0]).toContain("Elektronik");
  });

  it("kategori kosong berarti tanpa kategori", () => {
    expect(parse([row({ 4: "" })])[0].product?.categoryId).toBeNull();
  });

  it("wajib: nama, SKU, jenis, harga jual", () => {
    const [r] = parse([row({ 0: "", 1: "", 3: "", 6: "" })]);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        "Nama produk wajib diisi.",
        "SKU wajib diisi.",
        "Jenis produk wajib diisi.",
        "Harga jual wajib diisi.",
      ]),
    );
  });

  it("jenis tidak dikenal, harga 0, angka tidak valid, status tidak dikenal", () => {
    expect(parse([row({ 3: "ELEKTRONIK" })])[0].errors[0]).toContain("tidak dikenal");
    expect(parse([row({ 6: "0" })])[0].errors).toContain("Harga jual harus lebih dari 0.");
    expect(parse([row({ 8: "sepuluh" })])[0].errors[0]).toContain("Stok awal");
    expect(parse([row({ 10: "mungkin" })])[0].errors[0]).toContain("Status");
  });

  it("status Nonaktif dan kosong", () => {
    expect(parse([row({ 10: "Nonaktif" })])[0].product?.isActive).toBe(false);
    expect(parse([row({ 10: "" })])[0].product?.isActive).toBe(true);
  });

  it("JASA: stok dan minimum diabaikan, bahkan kalau isinya tidak valid", () => {
    const [r] = parse([row({ 3: "JASA", 8: "abc", 9: "xyz" })]);
    expect(r.product).toMatchObject({ type: "JASA", stock: 0, minStock: 0 });
  });

  it("satuan kosong jadi pcs", () => {
    expect(parse([row({ 5: "" })])[0].product?.unit).toBe("pcs");
  });
});

describe("parseProductSheet: duplikat", () => {
  it("SKU kembar di file: baris kedua ditolak dan menunjuk baris pertama", () => {
    const [a, b] = parse([row({ 1: "dup" }), row({ 1: "DUP", 0: "Lain" })]);
    expect(a.product).not.toBeNull();
    expect(b.errors).toContain("SKU sama dengan baris 2.");
  });

  it("SKU yang sudah ada di database ditolak", () => {
    const [r] = parse([row()], ctx({ existingSkus: new Set(["KP-1"]) }));
    expect(r.errors).toContain("SKU sudah dipakai produk lain.");
  });

  it("barcode kembar di file dan di database ditolak", () => {
    const rows = parse([row({ 1: "a", 2: "111" }), row({ 1: "b", 2: "111" })]);
    expect(rows[1].errors).toContain("Barcode sama dengan baris 2.");
    const [r] = parse([row({ 2: "999" })], ctx({ existingBarcodes: new Set(["999"]) }));
    expect(r.errors).toContain("Barcode sudah dipakai produk lain.");
  });

  it("barcode dengan spasi atau notasi ilmiah ditolak", () => {
    expect(parse([row({ 2: "12 34" })])[0].product).toBeNull();
    expect(parse([row({ 2: "8.99E+12" })])[0].errors[0]).toContain("angka ilmiah");
  });
});

describe("parseProductSheet: barcode otomatis", () => {
  it("barcode kosong diisi EAN-13 unik, barcode isian dipertahankan", () => {
    const rows = parse([
      row({ 1: "a" }),
      row({ 1: "b" }),
      row({ 1: "c", 2: "MANUAL-1" }),
    ]);
    const [a, b, c] = rows.map((r) => r.product!);
    expect(isEan13(a.barcode) && a.barcodeAuto).toBe(true);
    expect(isEan13(b.barcode) && b.barcodeAuto).toBe(true);
    expect(a.barcode).not.toBe(b.barcode);
    expect(c).toMatchObject({ barcode: "MANUAL-1", barcodeAuto: false });
  });

  it("tidak memakai barcode yang sudah ada di database", () => {
    let call = 0;
    // Dua kode pertama identik dengan yang sudah ada, jadi harus dilewati.
    const seq = "1111111111" + "1111111111" + "2222222222";
    const randomDigit = () => Number(seq[call++ % seq.length]);
    const first = parse([row()], ctx({ randomDigit }))[0].product!.barcode;
    call = 0;
    const [r] = parse([row()], ctx({ randomDigit, existingBarcodes: new Set([first]) }));
    expect(r.product!.barcode).not.toBe(first);
  });

  it("baris bermasalah tidak mendapat barcode", () => {
    const [r] = parse([row({ 0: "" })]);
    expect(r.product).toBeNull();
  });
});

describe("summarizeImport", () => {
  it("menghitung total, valid, bermasalah, dan barcode otomatis", () => {
    const rows = parse([row({ 1: "a" }), row({ 1: "b", 2: "X1" }), row({ 1: "c", 0: "" })]);
    expect(summarizeImport(rows)).toEqual({ total: 3, valid: 2, invalid: 1, autoBarcodes: 1 });
  });
});

describe("buildProductTemplateSheets", () => {
  it("menghasilkan sheet Produk, Petunjuk, Daftar berurutan", () => {
    const sheets = buildProductTemplateSheets(["Pakaian"]);
    expect(sheets.map((s) => s.name)).toEqual(["Produk", "Petunjuk", "Daftar"]);
    expect(sheets[0].rows[0]).toEqual(HEADER);
    expect(sheets[0].rows).toHaveLength(1);
    expect(sheets[0].freezeHeaderRow).toBe(true);
  });

  it("dropdown kategori menunjuk daftar kategori di sheet Daftar", () => {
    const [produk, , daftar] = buildProductTemplateSheets(["Pakaian", "Aksesoris", "Kemasan"]);
    const category = produk.validations?.find((v) => v.range.startsWith("E"));
    expect(category?.source).toBe("Daftar!$A$2:$A$4");
    expect(category?.range).toBe(`E2:E${MAX_IMPORT_ROWS + 1}`);
    expect(daftar.rows.slice(1).map((r) => r[0])).toEqual(["Pakaian", "Aksesoris", "Kemasan", null, null, null, null, null]);
  });

  it("dropdown jenis dan status selalu ada", () => {
    const [produk, , daftar] = buildProductTemplateSheets([]);
    expect(produk.validations?.some((v) => v.range.startsWith("D"))).toBe(true);
    expect(produk.validations?.some((v) => v.range.startsWith("K"))).toBe(true);
    expect(daftar.rows[1][1]).toBe("FASHION");
    expect(daftar.rows[1][2]).toBe("Aktif");
    expect(daftar.rows[2][2]).toBe("Nonaktif");
  });

  it("tanpa kategori tidak ada dropdown Kategori", () => {
    const [produk] = buildProductTemplateSheets([]);
    expect(produk.validations?.some((v) => v.range.startsWith("E"))).toBe(false);
  });

  it("kolom SKU dan Barcode diformat Teks", () => {
    const [produk] = buildProductTemplateSheets([]);
    expect(produk.columnFormats).toEqual([
      { column: 1, format: "@" },
      { column: 2, format: "@" },
    ]);
  });

  it("template lolos parser: contoh isian di Petunjuk tidak ikut terbaca", () => {
    const [produk] = buildProductTemplateSheets(["Pakaian"]);
    const header = produk.rows[0].map(String);
    expect(parseProductSheet([header], ctx())).toMatchObject({ ok: false });
  });
});
