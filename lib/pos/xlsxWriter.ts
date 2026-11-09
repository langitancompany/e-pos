// lib/pos/xlsxWriter.ts
// Penulis file Excel (.xlsx) minimal, dibangun di atas `jszip` yang sudah jadi
// dependency project. Menggantikan library `xlsx` (SheetJS 0.18.5) yang punya
// kerentanan terbuka dan sudah tidak dirilis lagi di npm.
//
// Cakupan SENGAJA kecil — hanya yang dipakai ekspor di app ini:
//   - beberapa sheet berisi tabel nilai (teks / angka / tanggal / kosong)
//   - lebar kolom
//   - format angka per sel (mis. "#,##0") dan format tanggal
// Tidak ada formula, merge cell, atau styling warna. Kalau nanti butuh itu,
// pertimbangkan library penuh (mis. exceljs) daripada memperluas file ini.
//
// Semua diproses di browser (tanpa server), sama seperti sebelumnya.
//
// Struktur dibagi dua supaya mudah dites:
//   - `buildXlsxFiles()`  : fungsi MURNI, menghasilkan isi XML tiap bagian file.
//   - `buildXlsxBlob()` / `downloadXlsx()` : membungkus XML itu jadi zip & unduh.

export type XlsxCell = string | number | Date | null | undefined;

/** Format sel untuk sekumpulan kolom pada rentang baris tertentu. */
export interface XlsxFormatRange {
  /** Indeks kolom, 0 = kolom A. */
  columns: number[];
  /** Indeks baris pertama, 0 = baris 1 (header kalau ada). Inklusif. */
  fromRow: number;
  /** Indeks baris terakhir. Inklusif. */
  toRow: number;
  /** Kode format Excel, mis. "#,##0" atau "dd/mm/yyyy hh:mm". */
  format: string;
}

/** Dropdown pilihan pada rentang sel, sumbernya rentang sel lain (boleh di sheet lain). */
export interface XlsxListValidation {
  /** Rentang yang diberi dropdown, mis. "E2:E1001". */
  range: string;
  /** Sumber daftar, mis. "Daftar!$A$2:$A$10". */
  source: string;
  /** Judul dan isi pesan saat isian di luar daftar (batas Excel 32 dan 255 karakter). */
  errorTitle?: string;
  error?: string;
  /** Petunjuk yang muncul saat sel dipilih. */
  promptTitle?: string;
  prompt?: string;
}

/** Format bawaan satu kolom penuh, berlaku juga untuk sel yang masih kosong. */
export interface XlsxColumnFormat {
  /** Indeks kolom, 0 = kolom A. */
  column: number;
  /** Mis. "@" supaya isian diperlakukan sebagai teks. */
  format: string;
}

export interface XlsxSheet {
  /** Nama tab. Karakter terlarang Excel diganti "-" dan dipotong 31 karakter. */
  name: string;
  rows: XlsxCell[][];
  /** Lebar tiap kolom dalam satuan karakter (setara `wch` di SheetJS). */
  colWidths?: number[];
  /**
   * Format sel. Hanya berlaku untuk sel angka dan tanggal; sel teks/kosong
   * diabaikan. Kalau beberapa rentang mengenai sel yang sama, yang terakhir menang.
   */
  formats?: XlsxFormatRange[];
  /** Format per kolom penuh, termasuk sel kosong yang nanti diisi pengguna. */
  columnFormats?: XlsxColumnFormat[];
  /** Dropdown pilihan untuk sel yang diisi pengguna. */
  validations?: XlsxListValidation[];
  /** Baris pertama tetap terlihat saat sheet digulir. */
  freezeHeaderRow?: boolean;
}

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Format bawaan untuk sel tanggal yang tidak diberi format eksplisit. */
export const DEFAULT_DATE_FORMAT = "dd/mm/yyyy hh:mm";

const MAX_CELL_TEXT_LENGTH = 32767; // batas Excel per sel
const MAX_SHEET_NAME_LENGTH = 31; // batas Excel per nama tab

// Format angka bawaan Excel — tidak perlu dideklarasikan ulang di styles.xml.
const BUILTIN_FORMAT_IDS: Record<string, number> = {
  General: 0,
  "0": 1,
  "0.00": 2,
  "#,##0": 3,
  "#,##0.00": 4,
  "0%": 9,
  "0.00%": 10,
  "@": 49,
};
const FIRST_CUSTOM_FORMAT_ID = 164;

// ── Util kecil ───────────────────────────────────────────────────────────────

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index;
  let result = "";
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

/** Membuang karakter yang tidak boleh ada di XML 1.0 (kontrol selain tab/LF/CR). */
function stripIllegalXmlChars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const legal =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
    if (legal) out += value[i];
  }
  return out;
}

function escapeXml(value: string): string {
  return stripIllegalXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tanggal → nomor seri Excel. Memakai jam DINDING lokal (bukan UTC): yang
 * tampil di Excel sama dengan jam yang dilihat pengguna di perangkatnya.
 */
export function toExcelSerial(date: Date): number {
  const localAsUtc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  return (localAsUtc - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function sanitizeSheetName(name: string): string {
  const cleaned = name
    .replace(/[\\/*?:[\]]/g, "-")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, MAX_SHEET_NAME_LENGTH);
  return cleaned || "Sheet";
}

// ── Registri style (format angka/tanggal → indeks <xf>) ──────────────────────

class StyleRegistry {
  private readonly styleIndexByFormat = new Map<string, number>();
  private readonly formats: string[] = []; // urut = indeks xf - 1

  /** Indeks style untuk `format`. 0 = default (tanpa format). */
  indexFor(format: string | null): number {
    if (!format || format === "General") return 0;
    const existing = this.styleIndexByFormat.get(format);
    if (existing !== undefined) return existing;
    this.formats.push(format);
    const index = this.formats.length; // xf 0 dicadangkan untuk default
    this.styleIndexByFormat.set(format, index);
    return index;
  }

  toXml(): string {
    const customFormats: { id: number; code: string }[] = [];
    const numFmtIdOf = (format: string): number => {
      const builtin = BUILTIN_FORMAT_IDS[format];
      if (builtin !== undefined) return builtin;
      const existing = customFormats.find((f) => f.code === format);
      if (existing) return existing.id;
      const id = FIRST_CUSTOM_FORMAT_ID + customFormats.length;
      customFormats.push({ id, code: format });
      return id;
    };

    const xfs = [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      ...this.formats.map(
        (format) =>
          `<xf numFmtId="${numFmtIdOf(format)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
      ),
    ];

    const numFmtsXml =
      customFormats.length > 0
        ? `<numFmts count="${customFormats.length}">${customFormats
            .map(
              (f) =>
                `<numFmt numFmtId="${f.id}" formatCode="${escapeXml(f.code)}"/>`,
            )
            .join("")}</numFmts>`
        : "";

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      numFmtsXml +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

// ── Sheet → XML ──────────────────────────────────────────────────────────────

function findFormat(
  formats: XlsxFormatRange[] | undefined,
  row: number,
  col: number,
): string | null {
  if (!formats) return null;
  for (let i = formats.length - 1; i >= 0; i -= 1) {
    const range = formats[i];
    if (
      row >= range.fromRow &&
      row <= range.toRow &&
      range.columns.includes(col)
    ) {
      return range.format;
    }
  }
  return null;
}

function buildSheetXml(sheet: XlsxSheet, styles: StyleRegistry): string {
  const rowsXml: string[] = [];

  sheet.rows.forEach((row, rowIndex) => {
    if (!row || row.length === 0) return; // baris kosong: cukup dilewati

    const cellsXml: string[] = [];
    row.forEach((value, colIndex) => {
      if (value === null || value === undefined) return;

      const ref = `${columnLetter(colIndex)}${rowIndex + 1}`;

      if (typeof value === "number") {
        if (!Number.isFinite(value)) return; // NaN/Infinity → sel kosong
        const style = styles.indexFor(
          findFormat(sheet.formats, rowIndex, colIndex),
        );
        cellsXml.push(
          `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`,
        );
        return;
      }

      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return; // tanggal tidak valid → kosong
        const style = styles.indexFor(
          findFormat(sheet.formats, rowIndex, colIndex) ?? DEFAULT_DATE_FORMAT,
        );
        cellsXml.push(
          `<c r="${ref}" s="${style}"><v>${toExcelSerial(value)}</v></c>`,
        );
        return;
      }

      // Teks selalu ditulis sebagai string (inlineStr) — tidak pernah dibaca
      // Excel sebagai rumus, jadi aman walau isinya diawali "=" atau "+".
      const text = escapeXml(String(value).slice(0, MAX_CELL_TEXT_LENGTH));
      cellsXml.push(
        `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`,
      );
    });

    if (cellsXml.length > 0) {
      rowsXml.push(`<row r="${rowIndex + 1}">${cellsXml.join("")}</row>`);
    }
  });

  const viewsXml = sheet.freezeHeaderRow
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : "";

  // Urutan elemen mengikuti skema OOXML: sheetViews, cols, sheetData, dataValidations.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    viewsXml +
    buildColsXml(sheet, styles) +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    buildValidationsXml(sheet.validations) +
    "</worksheet>"
  );
}

const DEFAULT_COLUMN_WIDTH = 8.43;
const MAX_ERROR_TITLE_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 255;

function buildColsXml(sheet: XlsxSheet, styles: StyleRegistry): string {
  const widths = sheet.colWidths ?? [];
  const formats = sheet.columnFormats ?? [];
  const count = Math.max(widths.length, ...formats.map((f) => f.column + 1));

  const cols: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const width = widths[i];
    const format = formats.find((f) => f.column === i);
    if (width === undefined && !format) continue;

    const style = format ? styles.indexFor(format.format) : 0;
    cols.push(
      `<col min="${i + 1}" max="${i + 1}" width="${width ?? DEFAULT_COLUMN_WIDTH}" customWidth="1"${style ? ` style="${style}"` : ""}/>`,
    );
  }
  return cols.length > 0 ? `<cols>${cols.join("")}</cols>` : "";
}

function buildValidationsXml(
  validations: XlsxListValidation[] | undefined,
): string {
  if (!validations || validations.length === 0) return "";

  const items = validations.map((v) => {
    const attrs = ['type="list"', 'allowBlank="1"', 'showErrorMessage="1"'];
    if (v.errorTitle) {
      attrs.push(
        `errorTitle="${escapeXml(v.errorTitle.slice(0, MAX_ERROR_TITLE_LENGTH))}"`,
      );
    }
    if (v.error) {
      attrs.push(`error="${escapeXml(v.error.slice(0, MAX_MESSAGE_LENGTH))}"`);
    }
    if (v.promptTitle || v.prompt) {
      attrs.push('showInputMessage="1"');
      if (v.promptTitle) {
        attrs.push(
          `promptTitle="${escapeXml(v.promptTitle.slice(0, MAX_ERROR_TITLE_LENGTH))}"`,
        );
      }
      if (v.prompt) {
        attrs.push(`prompt="${escapeXml(v.prompt.slice(0, MAX_MESSAGE_LENGTH))}"`);
      }
    }
    attrs.push(`sqref="${escapeXml(v.range)}"`);
    return `<dataValidation ${attrs.join(" ")}><formula1>${escapeXml(v.source)}</formula1></dataValidation>`;
  });

  return `<dataValidations count="${items.length}">${items.join("")}</dataValidations>`;
}

// ── Workbook → kumpulan file XML ─────────────────────────────────────────────

/**
 * Menyusun isi semua bagian file .xlsx (path di dalam zip → teks XML).
 * Fungsi murni: tanpa DOM dan tanpa jszip, jadi bisa dites langsung.
 */
export function buildXlsxFiles(sheets: XlsxSheet[]): Record<string, string> {
  if (sheets.length === 0) {
    throw new Error("File Excel butuh minimal 1 sheet.");
  }

  const names = sheets.map((sheet) => sanitizeSheetName(sheet.name));
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Nama sheet kembar: "${name}".`);
    }
    seen.add(key);
  }

  const styles = new StyleRegistry();
  const files: Record<string, string> = {};

  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = buildSheetXml(sheet, styles);
  });

  // styles.xml baru bisa dibuat SETELAH semua sheet diproses (registri terisi).
  files["xl/styles.xml"] = styles.toXml();

  files["[Content_Types].xml"] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  files["_rels/.rels"] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  files["xl/workbook.xml"] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${names
      .map(
        (name, i) =>
          `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets>` +
    "</workbook>";

  files["xl/_rels/workbook.xml.rels"] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  return files;
}

// ── Zip & unduh ──────────────────────────────────────────────────────────────

/** Membungkus hasil `buildXlsxFiles()` menjadi Blob .xlsx. */
export async function buildXlsxBlob(sheets: XlsxSheet[]): Promise<Blob> {
  const files = buildXlsxFiles(sheets);
  // Di-import saat dibutuhkan saja, supaya jszip tidak ikut bundle awal.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({
    type: "blob",
    mimeType: XLSX_MIME_TYPE,
    compression: "DEFLATE",
  });
}

/** Membuat file .xlsx lalu memicu unduhan di browser. */
export async function downloadXlsx(
  sheets: XlsxSheet[],
  fileName: string,
): Promise<void> {
  const blob = await buildXlsxBlob(sheets);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Beri waktu browser memulai unduhan sebelum URL dilepas.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
