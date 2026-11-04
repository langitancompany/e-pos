import { describe, expect, it } from "vitest";
import {
  LABEL_PRESETS,
  countBarcodeModules,
  estimateModuleMm,
  getPreset,
  isLandscape,
  labelsPerSheet,
  matchPageSize,
  outputPageSize,
  paginateLabels,
  validateSpec,
  DEFAULT_PRESET_KEY,
  type LabelItem,
  type LabelSheetSpec,
} from "../labelPrint";

const spec: LabelSheetSpec = {
  pageWidth: 210,
  pageHeight: 297,
  cols: 3,
  rows: 4,
  labelWidth: 60,
  labelHeight: 50,
  marginLeft: 10,
  marginTop: 10,
  gapX: 5,
  gapY: 5,
};

const items = (n: number): LabelItem[] =>
  Array.from({ length: n }, (_, i) => ({ code: `C${i + 1}`, name: `Produk ${i + 1}`, price: 1_000 }));

describe("preset label", () => {
  it("preset bawaan ada", () => {
    expect(getPreset(DEFAULT_PRESET_KEY)).toBeDefined();
    expect(getPreset("tidak-ada")).toBeUndefined();
  });

  it("semua preset muat di kertasnya (tidak ada pesan masalah)", () => {
    for (const preset of LABEL_PRESETS) {
      expect(validateSpec(preset.spec), preset.key).toBeNull();
    }
  });

  it("jumlah label per lembar sama dengan yang tertulis di deskripsi preset", () => {
    for (const preset of LABEL_PRESETS) {
      // Preset lembar: "... 12 label/lembar (3 × 4) ...". Preset roll: "1 label per halaman".
      const sheet = preset.description.match(/(\d+) label\/lembar/);
      const roll = preset.description.match(/^(\d+) label per halaman/);
      const expected = sheet?.[1] ?? roll?.[1];
      expect(expected, preset.key).toBeDefined();
      expect(labelsPerSheet(preset.spec), preset.key).toBe(Number(expected));
    }
  });

  it("kunci preset unik", () => {
    const keys = LABEL_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("labelsPerSheet", () => {
  it("kolom x baris", () => {
    expect(labelsPerSheet(spec)).toBe(12);
  });

  it("minimal 1 dan dibulatkan ke bawah", () => {
    expect(labelsPerSheet({ ...spec, cols: 0, rows: 0 })).toBe(1);
    expect(labelsPerSheet({ ...spec, cols: 2.9, rows: 3.9 })).toBe(6);
  });
});

describe("validateSpec", () => {
  it("spesifikasi yang muat -> null", () => {
    expect(validateSpec(spec)).toBeNull();
  });

  it("ukuran nol, negatif, atau bukan angka ditolak", () => {
    expect(validateSpec({ ...spec, pageWidth: 0 })).toBe("Lebar kertas harus lebih dari 0.");
    expect(validateSpec({ ...spec, pageHeight: -1 })).toBe("Tinggi kertas harus lebih dari 0.");
    expect(validateSpec({ ...spec, labelWidth: NaN })).toBe("Lebar label harus lebih dari 0.");
    expect(validateSpec({ ...spec, labelHeight: 0 })).toBe("Tinggi label harus lebih dari 0.");
  });

  it("kolom atau baris kurang dari 1 ditolak", () => {
    expect(validateSpec({ ...spec, cols: 0 })).toBe("Kolom dan baris minimal 1.");
    expect(validateSpec({ ...spec, rows: 0 })).toBe("Kolom dan baris minimal 1.");
  });

  it("jarak negatif (label bertumpuk) ditolak", () => {
    expect(validateSpec({ ...spec, gapX: -1 })).toMatch(/bertumpuk/);
    expect(validateSpec({ ...spec, gapY: -1 })).toMatch(/bertumpuk/);
  });

  it("selisih pembulatan kecil (<= 0,01 mm) masih diterima", () => {
    expect(validateSpec({ ...spec, gapX: -0.005 })).toBeNull();
  });

  it("susunan melebihi lebar atau tinggi kertas ditolak", () => {
    // 10 + 3*60 + 2*5 = 200; dibuat 4 kolom -> 10 + 240 + 15 = 265 > 210
    expect(validateSpec({ ...spec, cols: 4 })).toMatch(/melebihi lebar kertas/);
    // 10 + 6*50 + 5*5 = 335 > 297
    expect(validateSpec({ ...spec, rows: 6 })).toMatch(/melebihi tinggi kertas/);
  });
});

describe("orientasi & ukuran kertas", () => {
  it("isLandscape mengikuti ukuran kertas pada spesifikasi", () => {
    expect(isLandscape(spec)).toBe(false);
    expect(isLandscape({ ...spec, pageWidth: 297, pageHeight: 210 })).toBe(true);
    expect(isLandscape({ ...spec, pageWidth: 100, pageHeight: 100 })).toBe(true);
  });

  it("outputPageSize menukar lebar-tinggi saat diputar", () => {
    expect(outputPageSize(spec, false)).toEqual({ width: 210, height: 297 });
    expect(outputPageSize(spec, true)).toEqual({ width: 297, height: 210 });
  });

  it("matchPageSize mengenali kertas standar di kedua orientasi, selain itu custom", () => {
    expect(matchPageSize(spec)).toBe("a4");
    expect(matchPageSize({ ...spec, pageWidth: 297, pageHeight: 210 })).toBe("a4");
    expect(matchPageSize({ ...spec, pageWidth: 148, pageHeight: 210 })).toBe("a5");
    expect(matchPageSize({ ...spec, pageWidth: 195, pageHeight: 135 })).toBe("custom");
  });
});

describe("paginateLabels", () => {
  it("lembar diisi sampai penuh dengan slot null", () => {
    const sheets = paginateLabels(items(5), spec, 1);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toHaveLength(12);
    expect(sheets[0].slice(0, 5).every((s) => s !== null)).toBe(true);
    expect(sheets[0].slice(5).every((s) => s === null)).toBe(true);
  });

  it("posisi awal melewati slot yang sudah terpakai", () => {
    const [sheet] = paginateLabels(items(2), spec, 4);
    expect(sheet.slice(0, 3)).toEqual([null, null, null]);
    expect(sheet[3]?.code).toBe("C1");
    expect(sheet[4]?.code).toBe("C2");
  });

  it("label melimpah ke lembar berikutnya", () => {
    const sheets = paginateLabels(items(13), spec, 1);
    expect(sheets).toHaveLength(2);
    expect(sheets[1][0]?.code).toBe("C13");
    expect(sheets[1].slice(1).every((s) => s === null)).toBe(true);
  });

  it("posisi awal ikut menggeser batas lembar", () => {
    // mulai di slot 12 (terakhir): label pertama di ujung lembar 1, sisanya lembar 2
    const sheets = paginateLabels(items(2), spec, 12);
    expect(sheets).toHaveLength(2);
    expect(sheets[0][11]?.code).toBe("C1");
    expect(sheets[1][0]?.code).toBe("C2");
  });

  it("posisi awal di luar batas dijepit; nilai tak valid dianggap 1", () => {
    expect(paginateLabels(items(1), spec, 99)[0][11]?.code).toBe("C1");
    expect(paginateLabels(items(1), spec, 0)[0][0]?.code).toBe("C1");
    expect(paginateLabels(items(1), spec, NaN)[0][0]?.code).toBe("C1");
    expect(paginateLabels(items(1), spec, -5)[0][0]?.code).toBe("C1");
  });

  it("tanpa label dan mulai dari slot 1 -> tidak ada lembar", () => {
    expect(paginateLabels([], spec, 1)).toEqual([]);
  });

  it("tidak ada label yang hilang atau berubah urutan", () => {
    const sheets = paginateLabels(items(30), spec, 3);
    const flat = sheets.flat().filter((s): s is LabelItem => s !== null);
    expect(flat.map((s) => s.code)).toEqual(items(30).map((s) => s.code));
  });
});

describe("hitungan modul barcode", () => {
  it("countBarcodeModules = lebar Code128 + zona sunyi 2 x 10", () => {
    // "A": 11 * 3 simbol + 13 penutup = 46, + 20 zona sunyi
    expect(countBarcodeModules("A")).toBe(66);
  });

  it("teks yang tidak bisa di-encode -> null", () => {
    expect(countBarcodeModules("")).toBeNull();
    expect(countBarcodeModules("é")).toBeNull();
  });

  it("estimateModuleMm = lebar area / jumlah modul", () => {
    expect(estimateModuleMm("A", 66)).toBe(1);
    expect(estimateModuleMm("A", 33)).toBe(0.5);
    expect(estimateModuleMm("é", 50)).toBeNull();
  });
});
