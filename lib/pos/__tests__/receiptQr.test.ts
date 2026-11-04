import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMO_TEXT,
  getReceiptPromo,
  normalizePromoUrl,
  resolvePromoText,
} from "../receiptQr";

describe("normalizePromoUrl", () => {
  it("menambah https:// bila tanpa skema", () => {
    expect(normalizePromoUrl("linktr.ee/langitan")).toBe("https://linktr.ee/langitan");
  });

  it("mempertahankan skema http/https dan merapikan spasi tepi", () => {
    expect(normalizePromoUrl("  https://langitan.co  ")).toBe("https://langitan.co");
    expect(normalizePromoUrl("http://langitan.co/promo")).toBe("http://langitan.co/promo");
  });

  it("kosong, null, undefined -> null", () => {
    expect(normalizePromoUrl("")).toBeNull();
    expect(normalizePromoUrl("   ")).toBeNull();
    expect(normalizePromoUrl(null)).toBeNull();
    expect(normalizePromoUrl(undefined)).toBeNull();
  });

  it("menolak teks yang mengandung spasi", () => {
    expect(normalizePromoUrl("langitan co.id")).toBeNull();
  });

  it("menolak host tanpa titik atau berakhir titik", () => {
    expect(normalizePromoUrl("abc")).toBeNull();
    expect(normalizePromoUrl("http://localhost")).toBeNull();
    expect(normalizePromoUrl("example.com.")).toBeNull();
  });

  it("menolak skema selain http/https", () => {
    expect(normalizePromoUrl("ftp://langitan.co")).toBeNull();
    expect(normalizePromoUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("resolvePromoText", () => {
  it("memakai teks admin bila ada (dirapikan), default bila kosong", () => {
    expect(resolvePromoText("  Ikuti kami  ")).toBe("Ikuti kami");
    expect(resolvePromoText("")).toBe(DEFAULT_PROMO_TEXT);
    expect(resolvePromoText("   ")).toBe(DEFAULT_PROMO_TEXT);
    expect(resolvePromoText(null)).toBe(DEFAULT_PROMO_TEXT);
    expect(resolvePromoText(undefined)).toBe(DEFAULT_PROMO_TEXT);
  });
});

describe("getReceiptPromo", () => {
  it("promosi mati -> objek kosong (aman di-spread)", () => {
    expect(
      getReceiptPromo({ promoEnabled: false, promoUrl: "langitan.co", promoText: "Hai" }),
    ).toEqual({});
  });

  it("promosi hidup tapi link tidak valid -> objek kosong", () => {
    expect(
      getReceiptPromo({ promoEnabled: true, promoUrl: "abc", promoText: "Hai" }),
    ).toEqual({});
  });

  it("promosi hidup dan link valid -> link dinormalkan + teks", () => {
    expect(
      getReceiptPromo({ promoEnabled: true, promoUrl: "langitan.co", promoText: " Hai " }),
    ).toEqual({ promoUrl: "https://langitan.co", promoText: "Hai" });
  });

  it("teks kosong -> teks default", () => {
    expect(
      getReceiptPromo({ promoEnabled: true, promoUrl: "langitan.co", promoText: "" }),
    ).toEqual({ promoUrl: "https://langitan.co", promoText: DEFAULT_PROMO_TEXT });
  });
});
