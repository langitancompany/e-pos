import { describe, expect, it } from "vitest";
import { formatMoneyDigits, sanitizeMoneyDigits } from "../moneyInput";

describe("sanitizeMoneyDigits", () => {
  it("mengambil angka saja dari teks bebas", () => {
    expect(sanitizeMoneyDigits("Rp 200.000")).toBe("200000");
    expect(sanitizeMoneyDigits("2a0b")).toBe("20");
    expect(sanitizeMoneyDigits("200000")).toBe("200000");
  });

  it("membuang nol di depan, tapi menyisakan satu nol bila isinya nol semua", () => {
    expect(sanitizeMoneyDigits("007")).toBe("7");
    expect(sanitizeMoneyDigits("000")).toBe("0");
    expect(sanitizeMoneyDigits("0")).toBe("0");
    expect(sanitizeMoneyDigits("1000")).toBe("1000"); // nol di tengah/akhir aman
  });

  it("kosong atau tanpa angka -> string kosong", () => {
    expect(sanitizeMoneyDigits("")).toBe("");
    expect(sanitizeMoneyDigits("abc")).toBe("");
    expect(sanitizeMoneyDigits("Rp -")).toBe("");
  });

  it("tanda minus dan desimal tidak lolos", () => {
    expect(sanitizeMoneyDigits("-500")).toBe("500");
    expect(sanitizeMoneyDigits("1.5")).toBe("15");
  });

  it("dibatasi maxDigits (bawaan 12)", () => {
    expect(sanitizeMoneyDigits("1".repeat(20))).toHaveLength(12);
    expect(sanitizeMoneyDigits("123456", 3)).toBe("123");
  });

  it("pemotongan dilakukan sebelum buang nol depan", () => {
    // "0001234" dipotong ke 4 digit "0001" lalu jadi "1"
    expect(sanitizeMoneyDigits("0001234", 4)).toBe("1");
  });
});

describe("formatMoneyDigits", () => {
  it("menyisipkan titik ribuan", () => {
    expect(formatMoneyDigits("0")).toBe("0");
    expect(formatMoneyDigits("999")).toBe("999");
    expect(formatMoneyDigits("1000")).toBe("1.000");
    expect(formatMoneyDigits("200000")).toBe("200.000");
    expect(formatMoneyDigits("1234567")).toBe("1.234.567");
    expect(formatMoneyDigits("123456789012")).toBe("123.456.789.012");
  });

  it("string kosong tetap kosong", () => {
    expect(formatMoneyDigits("")).toBe("");
  });

  it("kombinasi sanitize + format untuk input pengguna", () => {
    expect(formatMoneyDigits(sanitizeMoneyDigits("Rp 0050000"))).toBe("50.000");
  });
});
