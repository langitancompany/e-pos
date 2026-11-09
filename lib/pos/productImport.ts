// Logika murni impor produk dari Excel: membuat template dan memvalidasi baris
// hasil bacaan file. Tanpa React dan tanpa Supabase supaya bisa dites di node.
// Penyimpanan ke database ada di productImportApi.ts.

import type { ProductType } from "./types";
import {
  barcodeTextError,
  generateBarcode,
  looksLikeScientific,
  type RandomDigit,
} from "./productBarcode";
import {
  columnLetter,
  type XlsxCell,
  type XlsxColumnFormat,
  type XlsxListValidation,
  type XlsxSheet,
} from "./xlsxWriter";

export const PRODUCT_SHEET_NAME = "Produk";
export const GUIDE_SHEET_NAME = "Petunjuk";
export const LISTS_SHEET_NAME = "Daftar";
export const MAX_IMPORT_ROWS = 1000;

export const IMPORT_PRODUCT_TYPES: ProductType[] = [
  "FASHION",
  "SABLON",
  "KONVEKSI",
  "PERCETAKAN",
  "MERCHANDISE",
  "PARFUM",
  "KEMASAN",
  "JASA",
];

const STATUS_ACTIVE = "Aktif";
const STATUS_INACTIVE = "Nonaktif";
const DEFAULT_UNIT = "pcs";
const HEADER_SEARCH_ROWS = 10;
const MIN_HEADER_MATCHES = 3;

type ColumnKey =
  | "name"
  | "sku"
  | "barcode"
  | "type"
  | "category"
  | "unit"
  | "sellPrice"
  | "costPrice"
  | "stock"
  | "minStock"
  | "status";

interface ColumnDef {
  key: ColumnKey;
  header: string;
  width: number;
  required: boolean;
  /** Nama kolom alternatif yang tetap dikenali (huruf kecil, tanpa tanda *). */
  aliases: string[];
  /** Kolom diformat Teks supaya Excel tidak mengubah kode jadi angka. */
  text?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", header: "Nama Produk*", width: 30, required: true, aliases: ["nama produk", "nama"] },
  { key: "sku", header: "SKU*", width: 18, required: true, aliases: ["sku"], text: true },
  { key: "barcode", header: "Barcode", width: 20, required: false, aliases: ["barcode"], text: true },
  { key: "type", header: "Jenis Produk*", width: 16, required: true, aliases: ["jenis produk", "jenis", "tipe"] },
  { key: "category", header: "Kategori", width: 20, required: false, aliases: ["kategori"] },
  { key: "unit", header: "Satuan", width: 10, required: false, aliases: ["satuan"] },
  { key: "sellPrice", header: "Harga Jual*", width: 14, required: true, aliases: ["harga jual"] },
  { key: "costPrice", header: "Harga Modal", width: 14, required: false, aliases: ["harga modal"] },
  { key: "stock", header: "Stok Awal", width: 11, required: false, aliases: ["stok awal", "stok"] },
  { key: "minStock", header: "Minimum Stok", width: 14, required: false, aliases: ["minimum stok", "min stok"] },
  { key: "status", header: "Status", width: 12, required: false, aliases: ["status"] },
];

const HEADER_LOOKUP = new Map<string, ColumnKey>(
  COLUMNS.flatMap((column) =>
    [column.header, ...column.aliases].map((label): [string, ColumnKey] => [
      normalizeHeader(label),
      column.key,
    ]),
  ),
);

function normalizeHeader(label: string): string {
  return label.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function columnOf(key: ColumnKey): string {
  return columnLetter(COLUMNS.findIndex((column) => column.key === key));
}

// ───────────────────────── Template ─────────────────────────

/**
 * Sheet untuk file template. `categoryNames` jadi isi dropdown kolom Kategori
 * lewat sheet Daftar, jadi harus kategori yang sama dengan yang tampil di aplikasi.
 */
export function buildProductTemplateSheets(categoryNames: string[]): XlsxSheet[] {
  const names = categoryNames.map((name) => name.trim()).filter(Boolean);
  const lastRow = MAX_IMPORT_ROWS + 1;
  const rangeOf = (key: ColumnKey) => `${columnOf(key)}2:${columnOf(key)}${lastRow}`;

  const validations: XlsxListValidation[] = [
    {
      range: rangeOf("type"),
      source: `${LISTS_SHEET_NAME}!$B$2:$B$${IMPORT_PRODUCT_TYPES.length + 1}`,
      errorTitle: "Jenis tidak dikenal",
      error: "Pilih jenis produk dari dropdown.",
      promptTitle: "Jenis produk",
      prompt: "Klik panah di kanan sel untuk memilih jenis.",
    },
    ...(names.length > 0
      ? [
          {
            range: rangeOf("category"),
            source: `${LISTS_SHEET_NAME}!$A$2:$A$${names.length + 1}`,
            errorTitle: "Kategori belum ada",
            error:
              "Pilih kategori dari dropdown. Kategori baru dibuat dulu di menu Produk, tab Kategori.",
            promptTitle: "Kategori",
            prompt: "Klik panah di kanan sel untuk memilih kategori.",
          },
        ]
      : []),
    {
      range: rangeOf("status"),
      source: `${LISTS_SHEET_NAME}!$C$2:$C$3`,
      errorTitle: "Status tidak dikenal",
      error: "Pilih Aktif atau Nonaktif.",
    },
  ];

  const columnFormats: XlsxColumnFormat[] = COLUMNS.flatMap((column, index) =>
    column.text ? [{ column: index, format: "@" }] : [],
  );

  const productSheet: XlsxSheet = {
    name: PRODUCT_SHEET_NAME,
    rows: [COLUMNS.map((column) => column.header)],
    colWidths: COLUMNS.map((column) => column.width),
    columnFormats,
    validations,
    freezeHeaderRow: true,
  };

  const exampleRow: XlsxCell[] = [
    "Kaos Polos Hitam",
    "KAOS-HITAM-L",
    null,
    "FASHION",
    names[0] ?? "Pakaian",
    DEFAULT_UNIT,
    75000,
    40000,
    10,
    2,
    STATUS_ACTIVE,
  ];

  const guideSheet: XlsxSheet = {
    name: GUIDE_SHEET_NAME,
    colWidths: [120],
    rows: [
      ["Cara mengisi template produk"],
      [],
      ["1. Isi data di sheet Produk mulai baris 2. Kolom bertanda * wajib diisi."],
      ["2. Jenis Produk, Kategori, dan Status dipilih dari dropdown di sel masing-masing."],
      [
        "3. Daftar Kategori diambil dari aplikasi saat template diunduh. Buat kategori baru di menu Produk, tab Kategori, lalu unduh template lagi.",
      ],
      ["4. Barcode boleh dikosongkan. Sistem membuatkan barcode otomatis saat file diunggah."],
      [`5. SKU harus unik. Satu file maksimal ${MAX_IMPORT_ROWS} produk.`],
      ["6. Harga dan stok ditulis sebagai angka bulat tanpa titik atau simbol Rp."],
      ["7. Produk berjenis JASA tidak memakai stok, kolom Stok Awal dan Minimum Stok diabaikan."],
      ["8. Satuan yang dikosongkan diisi pcs, Status yang dikosongkan dianggap Aktif."],
      [],
      ["Contoh isian"],
      COLUMNS.map((column) => column.header),
      exampleRow,
    ],
  };

  const listRows: XlsxCell[][] = [["Kategori", "Jenis Produk", "Status"]];
  const listLength = Math.max(names.length, IMPORT_PRODUCT_TYPES.length);
  for (let i = 0; i < listLength; i += 1) {
    const status = i === 0 ? STATUS_ACTIVE : i === 1 ? STATUS_INACTIVE : null;
    listRows.push([names[i] ?? null, IMPORT_PRODUCT_TYPES[i] ?? null, status]);
  }

  const listsSheet: XlsxSheet = {
    name: LISTS_SHEET_NAME,
    rows: listRows,
    colWidths: [24, 16, 12],
    freezeHeaderRow: true,
  };

  return [productSheet, guideSheet, listsSheet];
}

// ───────────────────────── Parsing ─────────────────────────

/**
 * Angka bulat dari teks sel. Menerima "15000", "15.000", "1.500.000", "Rp 15.000"
 * dan "15000.00". Hasil null berarti bukan bilangan bulat tak negatif.
 */
export function parseWholeNumber(raw: string): number | null {
  const text = raw.trim().replace(/^rp\.?\s*/i, "").replace(/\s/g, "");
  if (!text) return null;

  let value: number | null = null;
  if (/^\d+$/.test(text)) {
    value = Number(text);
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(text)) {
    value = Number(text.replace(/[.,]/g, ""));
  } else {
    const decimal = /^(\d+)[.,](\d+)$/.exec(text);
    if (decimal && /^0+$/.test(decimal[2])) value = Number(decimal[1]);
  }

  return value !== null && Number.isSafeInteger(value) ? value : null;
}

export interface ParsedProduct {
  name: string;
  sku: string;
  /** Terisi setelah barcode otomatis dibuat untuk baris yang barcode-nya kosong. */
  barcode: string;
  barcodeAuto: boolean;
  type: ProductType;
  categoryId: string | null;
  categoryName: string;
  unit: string;
  sellPrice: number;
  costPrice: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

export interface ImportRow {
  /** Nomor baris di Excel, supaya pengguna mudah mencarinya. */
  rowNumber: number;
  /** Nama produk, atau SKU kalau nama kosong, untuk ditampilkan di daftar. */
  label: string;
  errors: string[];
  /** Null kalau baris punya error. */
  product: ParsedProduct | null;
}

export interface ImportContext {
  categories: { id: string; name: string }[];
  /** SKU yang sudah ada di database, huruf besar. */
  existingSkus: ReadonlySet<string>;
  existingBarcodes: ReadonlySet<string>;
  /** Hanya untuk test: sumber digit acak barcode otomatis. */
  randomDigit?: RandomDigit;
}

export type ParseResult =
  | { ok: true; rows: ImportRow[] }
  | { ok: false; error: string };

function findHeader(
  rows: string[][],
): { rowIndex: number; columns: Partial<Record<ColumnKey, number>> } | null {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const columns: Partial<Record<ColumnKey, number>> = {};
    rows[rowIndex].forEach((cell, columnIndex) => {
      const key = HEADER_LOOKUP.get(normalizeHeader(cell));
      if (key && columns[key] === undefined) columns[key] = columnIndex;
    });
    if (Object.keys(columns).length >= MIN_HEADER_MATCHES) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !cell || !cell.trim());
}

export function parseProductSheet(rows: string[][], ctx: ImportContext): ParseResult {
  const header = findHeader(rows);
  if (!header) {
    return {
      ok: false,
      error:
        "Baris judul kolom tidak ditemukan. Pakai file dari tombol Download template.",
    };
  }

  const missing = COLUMNS.filter(
    (column) => column.required && header.columns[column.key] === undefined,
  ).map((column) => column.header.replace("*", ""));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Kolom wajib tidak ditemukan: ${missing.join(", ")}. Pakai file dari tombol Download template.`,
    };
  }

  const dataRows: { rowNumber: number; cells: string[] }[] = [];
  rows.slice(header.rowIndex + 1).forEach((cells, offset) => {
    if (!isBlankRow(cells)) {
      dataRows.push({ rowNumber: header.rowIndex + offset + 2, cells });
    }
  });

  if (dataRows.length === 0) {
    return {
      ok: false,
      error: "File belum berisi produk. Isi data mulai dari baris di bawah judul kolom.",
    };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `File berisi ${dataRows.length} produk. Maksimal ${MAX_IMPORT_ROWS} produk per file, bagi jadi beberapa file.`,
    };
  }

  const categoryByName = new Map(
    ctx.categories.map((category) => [category.name.trim().toLowerCase(), category]),
  );
  const seenSkus = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();

  const parsed = dataRows.map(({ rowNumber, cells }): ImportRow => {
    const get = (key: ColumnKey): string => {
      const index = header.columns[key];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    const errors: string[] = [];

    const name = get("name");
    if (!name) errors.push("Nama produk wajib diisi.");

    const sku = get("sku").toUpperCase();
    if (!sku) {
      errors.push("SKU wajib diisi.");
    } else if (looksLikeScientific(sku)) {
      errors.push("SKU terbaca sebagai angka ilmiah. Ubah format kolom SKU menjadi Teks lalu ketik ulang.");
    } else {
      const firstRow = seenSkus.get(sku);
      if (firstRow !== undefined) {
        errors.push(`SKU sama dengan baris ${firstRow}.`);
      } else {
        seenSkus.set(sku, rowNumber);
        if (ctx.existingSkus.has(sku)) errors.push("SKU sudah dipakai produk lain.");
      }
    }

    const barcode = get("barcode");
    if (barcode) {
      const barcodeError = looksLikeScientific(barcode)
        ? "Barcode terbaca sebagai angka ilmiah. Ubah format kolom Barcode menjadi Teks lalu ketik ulang."
        : barcodeTextError(barcode);
      if (barcodeError) {
        errors.push(barcodeError);
      } else {
        const firstRow = seenBarcodes.get(barcode);
        if (firstRow !== undefined) {
          errors.push(`Barcode sama dengan baris ${firstRow}.`);
        } else {
          seenBarcodes.set(barcode, rowNumber);
          if (ctx.existingBarcodes.has(barcode)) {
            errors.push("Barcode sudah dipakai produk lain.");
          }
        }
      }
    }

    const typeRaw = get("type");
    const type = IMPORT_PRODUCT_TYPES.find((item) => item === typeRaw.toUpperCase());
    if (!typeRaw) {
      errors.push("Jenis produk wajib diisi.");
    } else if (!type) {
      errors.push(`Jenis "${typeRaw}" tidak dikenal. Pilih dari dropdown.`);
    }

    const categoryRaw = get("category");
    let categoryId: string | null = null;
    let categoryName = "";
    if (categoryRaw) {
      const category = categoryByName.get(categoryRaw.toLowerCase());
      if (category) {
        categoryId = category.id;
        categoryName = category.name;
      } else {
        errors.push(
          `Kategori "${categoryRaw}" belum ada. Pilih dari dropdown atau buat dulu di tab Kategori.`,
        );
      }
    }

    const sellRaw = get("sellPrice");
    let sellPrice = 0;
    if (!sellRaw) {
      errors.push("Harga jual wajib diisi.");
    } else {
      const value = parseWholeNumber(sellRaw);
      if (value === null) {
        errors.push("Harga jual harus berupa angka bulat.");
      } else if (value <= 0) {
        errors.push("Harga jual harus lebih dari 0.");
      } else {
        sellPrice = value;
      }
    }

    const readWhole = (key: ColumnKey, label: string): number => {
      const raw = get(key);
      if (!raw) return 0;
      const value = parseWholeNumber(raw);
      if (value === null) {
        errors.push(`${label} harus berupa angka bulat, 0 atau lebih.`);
        return 0;
      }
      return value;
    };

    const costPrice = readWhole("costPrice", "Harga modal");
    const isService = type === "JASA";
    const stock = isService ? 0 : readWhole("stock", "Stok awal");
    const minStock = isService ? 0 : readWhole("minStock", "Minimum stok");

    const statusRaw = get("status");
    const statusKey = statusRaw.toLowerCase();
    let isActive = true;
    if (statusKey === "nonaktif" || statusKey === "tidak aktif") {
      isActive = false;
    } else if (statusKey && statusKey !== "aktif") {
      errors.push(`Status "${statusRaw}" tidak dikenal. Isi Aktif atau Nonaktif.`);
    }

    const label = name || sku || "(baris kosong)";
    if (errors.length > 0 || !type) {
      return { rowNumber, label, errors, product: null };
    }

    return {
      rowNumber,
      label,
      errors,
      product: {
        name,
        sku,
        barcode,
        barcodeAuto: false,
        type,
        categoryId,
        categoryName,
        unit: get("unit") || DEFAULT_UNIT,
        sellPrice,
        costPrice,
        stock,
        minStock,
        isActive,
      },
    };
  });

  return {
    ok: true,
    rows: withAutoBarcodes(parsed, ctx.existingBarcodes, ctx.randomDigit),
  };
}

// Barcode otomatis dibuat setelah validasi supaya tidak bentrok dengan barcode
// isian pengguna di baris mana pun, maupun yang sudah ada di database.
function withAutoBarcodes(
  rows: ImportRow[],
  existing: ReadonlySet<string>,
  randomDigit?: RandomDigit,
): ImportRow[] {
  const taken = new Set(existing);
  for (const row of rows) {
    if (row.product?.barcode) taken.add(row.product.barcode);
  }

  return rows.map((row) => {
    if (!row.product || row.product.barcode) return row;
    const barcode = generateBarcode(taken, randomDigit);
    taken.add(barcode);
    return { ...row, product: { ...row.product, barcode, barcodeAuto: true } };
  });
}

export interface ImportSummary {
  total: number;
  valid: number;
  invalid: number;
  autoBarcodes: number;
}

export function summarizeImport(rows: ImportRow[]): ImportSummary {
  const valid = rows.filter((row) => row.product !== null);
  return {
    total: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    autoBarcodes: valid.filter((row) => row.product?.barcodeAuto).length,
  };
}
