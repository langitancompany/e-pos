// Pembaca file Excel (.xlsx) minimal, pasangan xlsxWriter.ts, dibangun di atas
// `jszip`. Hanya membaca nilai sel satu sheet sebagai teks: tanpa formula,
// tanpa tanggal, tanpa gaya. Cukup untuk impor tabel sederhana seperti template produk.
//
// Parsing memakai regex, bukan DOMParser, supaya fungsi murninya bisa dites di node.

const MAX_SHEET_XML_CHARS = 30_000_000;

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// Excel menyimpan "_x000D_" untuk karakter kontrol di dalam teks.
function decodeEscapedControlChars(value: string): string {
  return value.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** Gabungan semua <t> di dalam potongan XML, tanpa teks fonetik (<rPh>). */
function collectText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of withoutPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += match[1] ?? "";
  }
  return decodeEscapedControlChars(decodeXml(text));
}

/** Daftar teks bersama (xl/sharedStrings.xml), diindeks seperti di file. */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    strings.push(collectText(match[1] ?? ""));
  }
  return strings;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? decodeXml(match[1]) : null;
}

function cellText(
  type: string | null,
  body: string,
  sharedStrings: string[],
): string {
  const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];

  switch (type) {
    case "s": {
      const index = Number(rawValue);
      return Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
    }
    case "inlineStr":
      return collectText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
    case "str":
      return rawValue === undefined ? "" : decodeXml(rawValue);
    case "b":
      return rawValue === "1" ? "TRUE" : "FALSE";
    case "e":
      return "";
    default:
      return rawValue === undefined ? "" : decodeXml(rawValue).trim();
  }
}

/**
 * Isi worksheet sebagai tabel teks. Indeks array = nomor baris - 1, sel yang
 * tidak ada diisi "". Angka dikembalikan apa adanya dari file (mis. "15000").
 */
export function parseSheetXml(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  let lastRow = -1;

  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttr = attribute(rowMatch[1], "r");
    const rowIndex = rowAttr ? Number(rowAttr) - 1 : lastRow + 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0) continue;
    lastRow = rowIndex;

    const cells: string[] = [];
    let lastCol = -1;

    for (const cellMatch of (rowMatch[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = /^([A-Za-z]+)\d+$/.exec(attribute(cellMatch[1], "r") ?? "");
      const colIndex = ref ? columnIndex(ref[1]) : lastCol + 1;
      lastCol = colIndex;
      cells[colIndex] = cellText(
        attribute(cellMatch[1], "t"),
        cellMatch[2] ?? "",
        sharedStrings,
      );
    }

    while (rows.length <= rowIndex) rows.push([]);
    rows[rowIndex] = Array.from(cells, (value) => value ?? "");
  }

  return rows;
}

export interface WorkbookSheetRef {
  name: string;
  /** Path file worksheet di dalam zip, mis. "xl/worksheets/sheet1.xml". */
  path: string;
}

/** Daftar sheet berurutan beserta path worksheet-nya. */
export function parseWorkbookSheets(
  workbookXml: string,
  relsXml: string,
): WorkbookSheetRef[] {
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1], "Id");
    const target = attribute(match[1], "Target");
    if (id && target) targets.set(id, target);
  }

  const sheets: WorkbookSheetRef[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attribute(match[1], "name");
    const relId = attribute(match[1], "r:id");
    const target = relId ? targets.get(relId) : undefined;
    if (!name || !target) continue;

    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    sheets.push({ name, path });
  }
  return sheets;
}

/**
 * Membaca satu sheet dari file .xlsx. Sheet dipilih lewat `preferredSheet`
 * (tanpa membedakan huruf besar kecil), kalau tidak ada dipakai sheet pertama.
 */
export async function readXlsxSheet(
  data: ArrayBuffer | Uint8Array,
  preferredSheet?: string,
): Promise<string[][]> {
  // Di-import saat dibutuhkan saja, supaya jszip tidak ikut bundle awal.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);

  const readText = async (path: string): Promise<string | null> => {
    const file = zip.file(path);
    return file ? file.async("string") : null;
  };

  const workbookXml = await readText("xl/workbook.xml");
  const relsXml = await readText("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) {
    throw new Error("File bukan Excel .xlsx yang valid.");
  }

  const sheets = parseWorkbookSheets(workbookXml, relsXml);
  if (sheets.length === 0) throw new Error("File Excel tidak punya sheet.");

  const wanted = preferredSheet?.trim().toLowerCase();
  const chosen =
    sheets.find((sheet) => sheet.name.trim().toLowerCase() === wanted) ?? sheets[0];

  const sheetXml = await readText(chosen.path);
  if (sheetXml === null) throw new Error(`Sheet "${chosen.name}" tidak bisa dibaca.`);
  if (sheetXml.length > MAX_SHEET_XML_CHARS) {
    throw new Error("Sheet terlalu besar untuk dibaca.");
  }

  const sharedXml = await readText("xl/sharedStrings.xml");
  return parseSheetXml(sheetXml, sharedXml ? parseSharedStrings(sharedXml) : []);
}
