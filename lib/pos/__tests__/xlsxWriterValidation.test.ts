import { describe, expect, it } from "vitest";
import { buildXlsxFiles } from "../xlsxWriter";

const sheetXml = (files: Record<string, string>) => files["xl/worksheets/sheet1.xml"];

describe("buildXlsxFiles: dropdown, format kolom, baris beku", () => {
  it("menulis dataValidation list dengan sumber rentang sheet lain", () => {
    const xml = sheetXml(
      buildXlsxFiles([
        {
          name: "S",
          rows: [["a"]],
          validations: [
            {
              range: "E2:E1001",
              source: "Daftar!$A$2:$A$5",
              errorTitle: "Salah",
              error: "Pilih dari daftar & ulangi",
            },
          ],
        },
      ]),
    );
    expect(xml).toContain('<dataValidations count="1">');
    expect(xml).toContain('type="list"');
    expect(xml).toContain('sqref="E2:E1001"');
    expect(xml).toContain("<formula1>Daftar!$A$2:$A$5</formula1>");
    expect(xml).toContain('error="Pilih dari daftar &amp; ulangi"');
  });

  it("dataValidations ada setelah sheetData", () => {
    const xml = sheetXml(
      buildXlsxFiles([
        { name: "S", rows: [["a"]], validations: [{ range: "A2:A3", source: "S!$A$1:$A$2" }] },
      ]),
    );
    expect(xml.indexOf("</sheetData>")).toBeLessThan(xml.indexOf("<dataValidations"));
  });

  it("format teks per kolom memakai numFmtId 49 dan style di <col>", () => {
    const files = buildXlsxFiles([
      { name: "S", rows: [["a"]], colWidths: [10, 12], columnFormats: [{ column: 1, format: "@" }] },
    ]);
    expect(sheetXml(files)).toContain('<col min="2" max="2" width="12" customWidth="1" style="1"/>');
    expect(sheetXml(files)).toContain('<col min="1" max="1" width="10" customWidth="1"/>');
    expect(files["xl/styles.xml"]).toContain('numFmtId="49"');
  });

  it("freezeHeaderRow menulis pane beku sebelum cols", () => {
    const xml = sheetXml(
      buildXlsxFiles([{ name: "S", rows: [["a"]], colWidths: [5], freezeHeaderRow: true }]),
    );
    expect(xml).toContain('state="frozen"');
    expect(xml.indexOf("<sheetViews>")).toBeLessThan(xml.indexOf("<cols>"));
  });

  it("tanpa opsi baru, hasil tidak memuat elemen tambahan", () => {
    const xml = sheetXml(buildXlsxFiles([{ name: "S", rows: [["a"]] }]));
    expect(xml).not.toContain("dataValidations");
    expect(xml).not.toContain("sheetViews");
  });
});
