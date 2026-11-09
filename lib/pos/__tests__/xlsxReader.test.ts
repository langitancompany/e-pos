import { describe, expect, it } from "vitest";
import {
  columnIndex,
  parseSharedStrings,
  parseSheetXml,
  parseWorkbookSheets,
  readXlsxSheet,
} from "../xlsxReader";
import { buildXlsxBlob } from "../xlsxWriter";

describe("columnIndex", () => {
  it("A=0, Z=25, AA=26", () => {
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("Z")).toBe(25);
    expect(columnIndex("AA")).toBe(26);
  });
});

describe("parseSharedStrings", () => {
  it("membaca teks biasa, rich text, entitas, dan mengabaikan fonetik", () => {
    const xml =
      '<sst><si><t>Kaos &amp; Polo</t></si>' +
      '<si><r><t>Ab</t></r><r><t xml:space="preserve"> cd</t></r></si>' +
      '<si><t>Nama</t><rPh><t>fonetik</t></rPh></si><si><t/></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(["Kaos & Polo", "Ab cd", "Nama", ""]);
  });
});

describe("parseSheetXml", () => {
  it("membaca shared string, inlineStr, angka, boolean, dan sel kosong", () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>SKU-1</t></is></c></row>' +
      '<row r="3"><c r="A3"><v>15000</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" s="2"/></row>' +
      '</sheetData></worksheet>';
    expect(parseSheetXml(xml, ["Judul"])).toEqual([
      ["Judul", "SKU-1"],
      [],
      ["15000", "", "TRUE", ""],
    ]);
  });
});

describe("parseWorkbookSheets", () => {
  it("memetakan nama sheet ke path worksheet", () => {
    const workbook =
      '<workbook><sheets><sheet name="Produk" sheetId="1" r:id="rId1"/><sheet name="Daftar" sheetId="2" r:id="rId2"/></sheets></workbook>';
    const rels =
      '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
    expect(parseWorkbookSheets(workbook, rels)).toEqual([
      { name: "Produk", path: "xl/worksheets/sheet1.xml" },
      { name: "Daftar", path: "xl/worksheets/sheet2.xml" },
    ]);
  });
});

describe("readXlsxSheet (bolak-balik dengan xlsxWriter)", () => {
  it("membaca kembali isi yang ditulis, memilih sheet berdasarkan nama", async () => {
    const blob = await buildXlsxBlob([
      { name: "Petunjuk", rows: [["abaikan"]] },
      {
        name: "Produk",
        rows: [
          ["Nama Produk*", "SKU*", "Harga Jual*"],
          ["Kaos & Polo", "0012", 75000],
        ],
      },
    ]);
    const rows = await readXlsxSheet(await blob.arrayBuffer(), "produk");
    expect(rows).toEqual([
      ["Nama Produk*", "SKU*", "Harga Jual*"],
      ["Kaos & Polo", "0012", "75000"],
    ]);
  });

  it("tanpa nama yang cocok memakai sheet pertama", async () => {
    const blob = await buildXlsxBlob([{ name: "Lain", rows: [["a", "b"]] }]);
    expect(await readXlsxSheet(await blob.arrayBuffer(), "Produk")).toEqual([["a", "b"]]);
  });

  it("file yang bukan xlsx melempar error", async () => {
    await expect(readXlsxSheet(new TextEncoder().encode("bukan zip"))).rejects.toThrow();
  });
});
