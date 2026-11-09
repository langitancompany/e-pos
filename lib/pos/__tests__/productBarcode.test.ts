import { describe, expect, it } from "vitest";
import {
  barcodeTextError,
  ean13CheckDigit,
  generateBarcode,
  isEan13,
  looksLikeScientific,
} from "../productBarcode";

// Sumber digit deterministik: mengembalikan isi `digits` berulang.
function digitsFrom(digits: string) {
  let i = 0;
  return () => Number(digits[i++ % digits.length]);
}

describe("ean13CheckDigit", () => {
  it("cocok dengan contoh EAN-13 yang dikenal", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(ean13CheckDigit("590123412345")).toBe(7);
  });

  it("menolak input yang bukan 12 digit", () => {
    expect(() => ean13CheckDigit("12345")).toThrow();
    expect(() => ean13CheckDigit("40063813339a")).toThrow();
  });
});

describe("isEan13", () => {
  it("memeriksa panjang dan digit pemeriksa", () => {
    expect(isEan13("4006381333931")).toBe(true);
    expect(isEan13("4006381333932")).toBe(false);
    expect(isEan13("400638133393")).toBe(false);
  });
});

describe("generateBarcode", () => {
  it("menghasilkan EAN-13 valid berawalan 20", () => {
    const code = generateBarcode(new Set(), digitsFrom("1234567890"));
    expect(code).toHaveLength(13);
    expect(code.startsWith("20")).toBe(true);
    expect(isEan13(code)).toBe(true);
  });

  it("selalu valid untuk digit acak sungguhan", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isEan13(generateBarcode())).toBe(true);
    }
  });

  it("melewati kode yang sudah dipakai", () => {
    const first = generateBarcode(new Set(), digitsFrom("1234567890"));
    const next = generateBarcode(new Set([first]), digitsFrom("12345678901111111111"));
    expect(next).not.toBe(first);
  });

  it("melempar error kalau semua percobaan bentrok", () => {
    const same = digitsFrom("0");
    const taken = new Set([generateBarcode(new Set(), digitsFrom("0"))]);
    expect(() => generateBarcode(taken, same)).toThrow("Gagal membuat barcode unik");
  });
});

describe("barcodeTextError", () => {
  it("menerima huruf, angka, dan simbol biasa", () => {
    expect(barcodeTextError("8990001234567")).toBeNull();
    expect(barcodeTextError("KAOS-01/A")).toBeNull();
  });

  it("menolak spasi, karakter non-ASCII, dan teks terlalu panjang", () => {
    expect(barcodeTextError("ab cd")).not.toBeNull();
    expect(barcodeTextError("kopi\u00e9")).not.toBeNull();
    expect(barcodeTextError("1".repeat(49))).toContain("terlalu panjang");
  });
});

describe("looksLikeScientific", () => {
  it("mengenali notasi ilmiah Excel, bukan kode biasa", () => {
    expect(looksLikeScientific("8.99E+12")).toBe(true);
    expect(looksLikeScientific("1E+13")).toBe(true);
    expect(looksLikeScientific("2E10")).toBe(false);
    expect(looksLikeScientific("KAOS-1")).toBe(false);
  });
});
