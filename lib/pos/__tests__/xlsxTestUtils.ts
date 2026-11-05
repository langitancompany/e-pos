// Pembantu test untuk ekspor Excel.
//
// Test ekspor tidak membuka file .xlsx sungguhan: `downloadXlsx` di-mock, lalu
// test membaca DATA SHEET yang dikirim ke fungsi itu (nama sheet, baris, lebar,
// format). Pembantu di sini mengubah data tersebut jadi bentuk yang enak
// diperiksa — mirip `sheet_to_json(header: 1)` dan akses sel A1 di SheetJS lama.
//
// Hanya mengimpor TIPE dari xlsxWriter (bukan nilai), karena modul itu
// di-mock di file test yang memakai pembantu ini.

import type { XlsxCell, XlsxSheet } from "@/lib/pos/xlsxWriter";

export interface FakeWorkbook {
  SheetNames: string[];
  sheets: XlsxSheet[];
}

export interface FakeCell {
  v: XlsxCell;
  /** "n" angka, "d" tanggal, "s" teks. */
  t: "n" | "d" | "s";
  /** Format yang berlaku untuk sel ini (hanya sel angka/tanggal). */
  z?: string;
}

export function toWorkbook(sheets: XlsxSheet[]): FakeWorkbook {
  return { SheetNames: sheets.map((sheet) => sheet.name), sheets };
}

function sheetOf(wb: FakeWorkbook, name: string): XlsxSheet {
  const sheet = wb.sheets.find((item) => item.name === name);
  if (!sheet) throw new Error(`Sheet "${name}" tidak ada di workbook.`);
  return sheet;
}

/**
 * Baris sheet sebagai array 2 dimensi. Semua baris dipadatkan ke lebar baris
 * terpanjang; sel kosong (null/undefined) diisi `defval`. Baris kosong di
 * paling bawah dibuang.
 */
export function sheetRows(
  wb: FakeWorkbook,
  name: string,
  defval: "" | null,
): unknown[][] {
  const rows = [...sheetOf(wb, name).rows];
  while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) =>
    Array.from({ length: width }, (_, i) => {
      const value = row[i];
      return value === null || value === undefined ? defval : value;
    }),
  );
}

/** Sel pada alamat gaya Excel ("B2"). Melempar error kalau selnya kosong. */
export function cellAt(
  wb: FakeWorkbook,
  sheetName: string,
  address: string,
): FakeCell {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`Alamat sel tidak valid: ${address}`);

  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  col -= 1;
  const row = Number(match[2]) - 1;

  const sheet = sheetOf(wb, sheetName);
  const value = sheet.rows[row]?.[col];
  if (value === null || value === undefined) {
    throw new Error(`Sel ${sheetName}!${address} kosong.`);
  }

  const type = typeof value === "number" ? "n" : value instanceof Date ? "d" : "s";
  let z: string | undefined;
  if (type !== "s") {
    for (const range of sheet.formats ?? []) {
      if (
        row >= range.fromRow &&
        row <= range.toRow &&
        range.columns.includes(col)
      ) {
        z = range.format; // yang terakhir menang, sama seperti penulis aslinya
      }
    }
  }
  return { v: value, t: type, z };
}
