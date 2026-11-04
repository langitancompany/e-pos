import { describe, expect, it } from "vitest";
import { formatMethod, formatMoney } from "../printLogic";

describe("formatMethod", () => {
  it("metode dikenal dipetakan ke label struk", () => {
    expect(formatMethod("CASH")).toBe("Tunai");
    expect(formatMethod("tunai")).toBe("Tunai");
    expect(formatMethod("DIGITAL")).toBe("Digital");
    expect(formatMethod("transfer")).toBe("Digital");
    expect(formatMethod("BANK_TRANSFER")).toBe("Digital");
    expect(formatMethod("QRIS")).toBe("Digital");
    expect(formatMethod("TEMPO")).toBe("Piutang");
  });

  it("metode tak dikenal ditampilkan huruf besar", () => {
    expect(formatMethod("ovo")).toBe("OVO");
  });
});

describe("formatMoney", () => {
  it("pemisah ribuan titik (format Indonesia)", () => {
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(950)).toBe("950");
    expect(formatMoney(1_250)).toBe("1.250");
    expect(formatMoney(1_234_567)).toBe("1.234.567");
  });

  it("pecahan dibulatkan ke rupiah terdekat", () => {
    expect(formatMoney(1_234.4)).toBe("1.234");
    expect(formatMoney(1_234.5)).toBe("1.235");
  });

  it("nilai negatif (refund) tetap terbaca", () => {
    expect(formatMoney(-30_000)).toContain("30.000");
  });
});
