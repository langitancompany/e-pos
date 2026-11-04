import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBarcodeSvgSafe,
  encodeCode128B,
  renderBarcodeSvg,
  type BarcodeModule,
} from "../barcode";

const widths = (mods: BarcodeModule[]) => mods.map((m) => m.width).join("");
/** Kelompokkan modul jadi pola per simbol (6 modul; simbol terakhir/STOP 7 modul). */
function symbols(mods: BarcodeModule[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < mods.length - 7; i += 6) out.push(widths(mods.slice(i, i + 6)));
  out.push(widths(mods.slice(mods.length - 7)));
  return out;
}

describe("encodeCode128B", () => {
  it("diawali START B dan diakhiri STOP (pola standar ISO 15417)", () => {
    const syms = symbols(encodeCode128B("A"));
    expect(syms[0]).toBe("211214"); // START B
    expect(syms[syms.length - 1]).toBe("2331112"); // STOP
  });

  it("jumlah simbol = START + karakter + checksum + STOP", () => {
    expect(symbols(encodeCode128B("LCO-STR/26/11/000001"))).toHaveLength(20 + 3);
  });

  it("lebar total: 11 modul per simbol, STOP 13 modul", () => {
    for (const text of ["A", "12345", "LCO-STR/26/11/000001"]) {
      const mods = encodeCode128B(text);
      const total = mods.reduce((s, m) => s + m.width, 0);
      expect(total).toBe(11 * (text.length + 2) + 13);
    }
  });

  it("batang dan spasi bergantian, selalu mulai dengan batang", () => {
    const mods = encodeCode128B("ABC");
    expect(mods[0].isBar).toBe(true);
    mods.forEach((m, i) => {
      // STOP: 7 modul -> berakhir dengan batang; setiap simbol sebelumnya 6 modul
      expect(m.isBar).toBe(i % 2 === 0 || isStopIndex(i, mods.length));
    });
    function isStopIndex(i: number, len: number) {
      // dalam STOP (7 modul) indeks genap/ganjil tetap bergantian mulai dari batang
      return i >= len - 7 && (i - (len - 7)) % 2 === 0;
    }
  });

  it("lebar modul selalu 1-4", () => {
    for (const m of encodeCode128B("The quick brown fox ~ 0123")) {
      expect(m.width).toBeGreaterThanOrEqual(1);
      expect(m.width).toBeLessThanOrEqual(4);
    }
  });

  it("checksum benar (dihitung ulang secara independen)", () => {
    // Peta nilai -> pola dibangun dari pengkodean 1 karakter: [START, v, checksum, STOP].
    const patternOf = new Map<number, string>();
    for (let code = 32; code <= 126; code++) {
      patternOf.set(code - 32, symbols(encodeCode128B(String.fromCharCode(code)))[1]);
    }

    let verified = 0;
    for (const text of ["A", "AB", "LCO-STR/26/11/000001", "INV-2026/0001", "Hello World", "0123456789"]) {
      const values = [...text].map((c) => c.charCodeAt(0) - 32);
      const checksum = (104 + values.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
      const syms = symbols(encodeCode128B(text));
      const actual = syms[syms.length - 2];
      if (patternOf.has(checksum)) {
        expect(actual).toBe(patternOf.get(checksum));
        verified++;
      }
    }
    expect(verified).toBeGreaterThan(0);
  });

  it("karakter berbeda menghasilkan pola berbeda; teks sama deterministik", () => {
    expect(encodeCode128B("A")).toEqual(encodeCode128B("A"));
    expect(widths(encodeCode128B("A"))).not.toBe(widths(encodeCode128B("B")));
  });

  it("urutan karakter berpengaruh (checksum berbobot posisi)", () => {
    expect(widths(encodeCode128B("AB"))).not.toBe(widths(encodeCode128B("BA")));
  });

  it("menerima batas ASCII 32 (spasi) dan 126 (~)", () => {
    expect(() => encodeCode128B(" ")).not.toThrow();
    expect(() => encodeCode128B("~")).not.toThrow();
  });

  it("menolak teks kosong", () => {
    expect(() => encodeCode128B("")).toThrow("Teks barcode tidak boleh kosong.");
  });

  it("menolak karakter di luar ASCII 32-126", () => {
    expect(() => encodeCode128B("abé")).toThrow(/tidak didukung/);
    expect(() => encodeCode128B("a\nb")).toThrow(/tidak didukung/);
    expect(() => encodeCode128B("a\u007f")).toThrow(/tidak didukung/); // DEL
    expect(() => encodeCode128B("😀")).toThrow(/tidak didukung/);
  });
});

describe("renderBarcodeSvg", () => {
  const mods: BarcodeModule[] = [
    { isBar: true, width: 1 },
    { isBar: false, width: 2 },
    { isBar: true, width: 3 },
  ];

  it("hanya batang yang digambar, posisi x mengikuti lebar modul", () => {
    const svg = renderBarcodeSvg(mods, 40, 2);
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg).toContain('<rect x="0" y="0" width="2" height="40"');
    expect(svg).toContain('<rect x="6" y="0" width="6" height="40"'); // setelah 2 + 4
  });

  it("viewBox = total lebar x moduleUnit, tinggi sesuai parameter", () => {
    const svg = renderBarcodeSvg(mods, 55, 3);
    expect(svg).toContain('viewBox="0 0 18 55"');
    expect(svg).toContain('height="55"');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('width="100%"');
  });

  it("parameter bawaan: tinggi 40, unit 2", () => {
    const svg = renderBarcodeSvg(mods);
    expect(svg).toContain('viewBox="0 0 12 40"');
  });
});

describe("buildBarcodeSvgSafe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("teks valid -> markup svg", () => {
    const svg = buildBarcodeSvgSafe("LCO-STR/26/11/000001");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("teks tak valid -> string kosong (struk tetap tercetak), hanya peringatan", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(buildBarcodeSvgSafe("struk é")).toBe("");
    expect(buildBarcodeSvgSafe("")).toBe("");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("meneruskan tinggi dan unit", () => {
    expect(buildBarcodeSvgSafe("A", 70, 1)).toContain('height="70"');
  });
});
