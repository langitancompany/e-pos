import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATE_FORMAT,
  buildXlsxFiles,
  columnLetter,
  sanitizeSheetName,
  toExcelSerial,
  type XlsxSheet,
} from "../xlsxWriter";

// buildXlsxFiles() murni (tanpa DOM/jszip): hasilnya peta path → teks XML,
// jadi bisa diperiksa langsung sebagai string.
const sheet1 = (files: Record<string, string>) => files["xl/worksheets/sheet1.xml"];
const build = (rows: XlsxSheet["rows"], extra: Partial<XlsxSheet> = {}) =>
  buildXlsxFiles([{ name: "S", rows, ...extra }]);

describe("columnLetter", () => {
  it("menghitung huruf kolom gaya Excel", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("toExcelSerial", () => {
  it("memakai jam dinding lokal, bukan UTC", () => {
    // Nilai pembanding dihitung terpisah: hari sejak 1899-12-30.
    expect(toExcelSerial(new Date(2026, 0, 1))).toBe(46023);
    expect(toExcelSerial(new Date(2026, 10, 4, 12, 0))).toBe(46330.5);
    expect(toExcelSerial(new Date(2026, 10, 4, 6, 0))).toBe(46330.25);
  });
});

describe("sanitizeSheetName", () => {
  it("mengganti karakter terlarang, memotong 31 karakter, dan tidak pernah kosong", () => {
    expect(sanitizeSheetName("Laporan/2026: [x]?*")).toBe("Laporan-2026- -x---");
    expect(sanitizeSheetName("a".repeat(40))).toHaveLength(31);
    expect(sanitizeSheetName("   ")).toBe("Sheet");
    expect(sanitizeSheetName("Per Shift")).toBe("Per Shift");
  });
});

describe("buildXlsxFiles — struktur file", () => {
  it("menghasilkan semua bagian wajib, satu worksheet per sheet", () => {
    const files = buildXlsxFiles([
      { name: "Satu", rows: [["a"]] },
      { name: "Dua", rows: [["b"]] },
    ]);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(files["[Content_Types].xml"]).toContain("/xl/worksheets/sheet1.xml");
    expect(files["[Content_Types].xml"]).toContain("/xl/worksheets/sheet2.xml");
    expect(files["xl/_rels/workbook.xml.rels"]).toContain('Target="worksheets/sheet2.xml"');
    expect(files["xl/_rels/workbook.xml.rels"]).toContain('Id="rId3"'); // styles setelah 2 sheet
  });

  it("nama sheet di workbook.xml berurutan dan di-escape", () => {
    const wb = buildXlsxFiles([
      { name: "R&D", rows: [] },
      { name: "Per Shift", rows: [] },
    ])["xl/workbook.xml"];
    expect(wb.indexOf('name="R&amp;D"')).toBeGreaterThan(-1);
    expect(wb.indexOf('name="R&amp;D"')).toBeLessThan(wb.indexOf('name="Per Shift"'));
  });

  it("menolak workbook tanpa sheet dan nama sheet kembar (tanpa beda huruf)", () => {
    expect(() => buildXlsxFiles([])).toThrow("minimal 1 sheet");
    expect(() =>
      buildXlsxFiles([
        { name: "Stok", rows: [] },
        { name: "stok", rows: [] },
      ]),
    ).toThrow("kembar");
  });
});

describe("buildXlsxFiles — isi sel", () => {
  it("angka ditulis sebagai angka, teks sebagai inlineStr", () => {
    const xml = sheet1(build([["Omzet", 1500000, -2.5]]));
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Omzet</t></is></c>');
    expect(xml).toContain('<c r="B1"><v>1500000</v></c>');
    expect(xml).toContain('<c r="C1"><v>-2.5</v></c>');
  });

  it("teks di-escape, karakter ilegal dibuang, dan awalan '=' tetap teks (bukan rumus)", () => {
    const xml = sheet1(build([["a & b < c > \"d\"", "=SUM(A1)", "ok\u0001\u0008!"]]));
    expect(xml).toContain("a &amp; b &lt; c &gt; &quot;d&quot;");
    expect(xml).toContain('t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t>');
    expect(xml).toContain(">ok!</t>");
    expect(xml).not.toContain("<f>");
  });

  it("null, undefined, NaN, Infinity dan tanggal tidak valid menjadi sel kosong", () => {
    const xml = sheet1(build([[null, undefined, NaN, Infinity, new Date("invalid"), "x"]]));
    expect(xml).not.toContain('r="A1"');
    expect(xml).not.toContain('r="B1"');
    expect(xml).not.toContain('r="C1"');
    expect(xml).not.toContain('r="D1"');
    expect(xml).not.toContain('r="E1"');
    expect(xml).toContain('<c r="F1" t="inlineStr">');
  });

  it("nomor baris tetap sesuai posisi walau ada baris kosong", () => {
    const xml = sheet1(build([["a"], [], ["c"]]));
    expect(xml).toContain('<row r="1">');
    expect(xml).not.toContain('<row r="2"');
    expect(xml).toContain('<row r="3">');
  });

  it("kolom setelah Z memakai huruf ganda", () => {
    const row = Array.from({ length: 28 }, (_, i) => i);
    const xml = sheet1(build([row]));
    expect(xml).toContain('<c r="Z1"><v>25</v></c>');
    expect(xml).toContain('<c r="AA1"><v>26</v></c>');
    expect(xml).toContain('<c r="AB1"><v>27</v></c>');
  });

  it("tanggal ditulis sebagai nomor seri dengan format tanggal bawaan", () => {
    const xml = sheet1(build([[new Date(2026, 10, 4, 12, 0)]]));
    expect(xml).toContain('<c r="A1" s="1"><v>46330.5</v></c>');
    expect(build([[new Date()]])["xl/styles.xml"]).toContain(`formatCode="${DEFAULT_DATE_FORMAT}"`);
  });

  it("lebar kolom ditulis di <cols> sebelum <sheetData>", () => {
    const xml = sheet1(build([["a", "b"]], { colWidths: [24, 52] }));
    expect(xml).toContain('<col min="1" max="1" width="24" customWidth="1"/>');
    expect(xml).toContain('<col min="2" max="2" width="52" customWidth="1"/>');
    expect(xml.indexOf("<cols>")).toBeLessThan(xml.indexOf("<sheetData>"));
  });
});

describe("buildXlsxFiles — format sel", () => {
  it("format #,##0 memakai id bawaan Excel (3) tanpa deklarasi numFmts", () => {
    const files = build([["Qty"], [1000]], {
      formats: [{ columns: [0], fromRow: 1, toRow: 1, format: "#,##0" }],
    });
    expect(sheet1(files)).toContain('<c r="A2" s="1"><v>1000</v></c>');
    expect(files["xl/styles.xml"]).toContain('numFmtId="3"');
    expect(files["xl/styles.xml"]).not.toContain("<numFmts");
    expect(files["xl/styles.xml"]).toContain('<cellXfs count="2">');
  });

  it("format hanya berlaku untuk sel angka/tanggal, bukan teks, dan hanya di rentangnya", () => {
    const xml = sheet1(
      build([["No", "Qty"], ["a", 5], [7, 8]], {
        formats: [{ columns: [0, 1], fromRow: 2, toRow: 2, format: "#,##0" }],
      }),
    );
    expect(xml).toContain('<c r="A1" t="inlineStr">'); // header teks
    expect(xml).toContain('<c r="B2"><v>5</v></c>'); // di luar rentang baris
    expect(xml).toContain('<c r="A3" s="1"><v>7</v></c>');
    expect(xml).toContain('<c r="B3" s="1"><v>8</v></c>');
  });

  it("format kustom dapat id mulai 164 dan dipakai ulang, tidak digandakan", () => {
    const files = build([[1, 2]], {
      formats: [{ columns: [0, 1], fromRow: 0, toRow: 0, format: "0.0%x" }],
    });
    const styles = files["xl/styles.xml"];
    expect(styles).toContain('<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%x"/></numFmts>');
    expect(styles).toContain('<cellXfs count="2">');
    expect(sheet1(files)).toContain('<c r="A1" s="1"><v>1</v></c>');
    expect(sheet1(files)).toContain('<c r="B1" s="1"><v>2</v></c>');
  });

  it("kalau beberapa rentang mengenai sel yang sama, yang terakhir menang", () => {
    const files = build([[10]], {
      formats: [
        { columns: [0], fromRow: 0, toRow: 0, format: "#,##0" },
        { columns: [0], fromRow: 0, toRow: 0, format: "0.00" },
      ],
    });
    // Hanya format pemenang (0.00 = id bawaan 2) yang didaftarkan sebagai style.
    expect(files["xl/styles.xml"]).toContain('numFmtId="2"');
    expect(files["xl/styles.xml"]).not.toContain('numFmtId="3"');
    expect(files["xl/styles.xml"]).toContain('<cellXfs count="2">');
    expect(sheet1(files)).toContain('<c r="A1" s="1"><v>10</v></c>');
  });

  it("format yang sama dipakai lintas sheet berbagi satu style", () => {
    const fmt = [{ columns: [0], fromRow: 0, toRow: 0, format: "#,##0" }];
    const files = buildXlsxFiles([
      { name: "A", rows: [[1]], formats: fmt },
      { name: "B", rows: [[2]], formats: fmt },
    ]);
    expect(files["xl/worksheets/sheet1.xml"]).toContain('s="1"');
    expect(files["xl/worksheets/sheet2.xml"]).toContain('s="1"');
    expect(files["xl/styles.xml"]).toContain('<cellXfs count="2">');
  });
});
