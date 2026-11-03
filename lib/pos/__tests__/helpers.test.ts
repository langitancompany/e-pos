import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMoneyDigits, sanitizeMoneyDigits } from "../moneyInput";
import { PAGE_SIZE, chunkArray, fetchAllPages } from "../paginate";
import { encodeCode128B } from "../barcode";
import {
  VALID_MENU_KEYS,
  clearStoredMenu,
  readStoredMenu,
  saveActiveMenu,
} from "../activeMenu";

describe("moneyInput", () => {
  it("hanya menyisakan digit dan membuang nol di depan", () => {
    expect(sanitizeMoneyDigits("Rp 200.000")).toBe("200000");
    expect(sanitizeMoneyDigits("2a0b")).toBe("20");
    expect(sanitizeMoneyDigits("007")).toBe("7");
    expect(sanitizeMoneyDigits("000")).toBe("0");
    expect(sanitizeMoneyDigits("")).toBe("");
  });

  it("membatasi jumlah digit", () => {
    expect(sanitizeMoneyDigits("1234567890123456")).toBe("123456789012");
    expect(sanitizeMoneyDigits("12345", 3)).toBe("123");
  });

  it("memformat ribuan dengan titik", () => {
    expect(formatMoneyDigits("200000")).toBe("200.000");
    expect(formatMoneyDigits("1234567")).toBe("1.234.567");
    expect(formatMoneyDigits("999")).toBe("999");
    expect(formatMoneyDigits("")).toBe("");
  });
});

describe("chunkArray", () => {
  it("memecah array menjadi potongan berukuran tetap", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 3)).toEqual([]);
  });
});

describe("fetchAllPages", () => {
  it("berhenti setelah halaman yang tidak penuh dan memakai rentang yang benar", async () => {
    const calls: Array<[number, number]> = [];
    const pages = [
      Array.from({ length: PAGE_SIZE }, (_, i) => i),
      Array.from({ length: 5 }, (_, i) => PAGE_SIZE + i),
    ];
    const rows = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: pages[calls.length - 1], error: null };
    });
    expect(rows).toHaveLength(PAGE_SIZE + 5);
    expect(calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);
  });

  it("data null dianggap halaman kosong", async () => {
    expect(await fetchAllPages(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it("melempar error dari query", async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: "gagal" } })),
    ).rejects.toThrow("gagal");
  });
});

describe("encodeCode128B", () => {
  const totalWidth = (text: string) =>
    encodeCode128B(text).reduce((sum, m) => sum + m.width, 0);

  it("lebar total = 11 × (jumlah simbol) + 13 untuk penutup", () => {
    // simbol = START + n karakter + checksum; STOP lebarnya 13
    expect(totalWidth("A")).toBe(11 * 3 + 13);
    expect(totalWidth("LCO-STR/26/11/0001")).toBe(11 * (18 + 2) + 13);
  });

  it("selalu diawali batang dan diakhiri batang (penutup)", () => {
    const m = encodeCode128B("123");
    expect(m[0].isBar).toBe(true);
    expect(m[m.length - 1].isBar).toBe(true);
  });

  it("menolak teks kosong dan karakter di luar ASCII 32-126", () => {
    expect(() => encodeCode128B("")).toThrow();
    expect(() => encodeCode128B("é")).toThrow();
    expect(() => encodeCode128B("a\nb")).toThrow();
  });
});

describe("activeMenu (sessionStorage)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSession(initial: Record<string, string> = {}) {
    const store = { ...initial };
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => void (store[k] = v),
        removeItem: (k: string) => void delete store[k],
      },
    });
  }

  it("menyimpan dan membaca kunci menu yang valid", () => {
    stubSession();
    saveActiveMenu("kasir");
    expect(readStoredMenu()).toBe("kasir");
  });

  it("mengabaikan kunci tak dikenal", () => {
    stubSession();
    saveActiveMenu("menu-hantu");
    expect(readStoredMenu()).toBeNull();
  });

  it("clearStoredMenu menghapus pilihan", () => {
    stubSession();
    saveActiveMenu("promo");
    clearStoredMenu();
    expect(readStoredMenu()).toBeNull();
  });

  it("tidak melempar error bila sessionStorage tidak tersedia", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): never {
        throw new Error("blocked");
      },
    });
    expect(() => saveActiveMenu("kasir")).not.toThrow();
    expect(readStoredMenu()).toBeNull();
    expect(() => clearStoredMenu()).not.toThrow();
  });

  it("semua kunci menu unik", () => {
    expect(new Set(VALID_MENU_KEYS).size).toBe(VALID_MENU_KEYS.length);
  });
});
