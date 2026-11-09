import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    pages: [] as { data: unknown[] | null; error: { message: string } | null }[],
    ranges: [] as [number, number][],
    counts: [] as { count: number | null; error: { message: string } | null }[],
    eqCalls: [] as string[],
  };
  const client = {
    from: () => {
      let mode: "page" | "count" = "page";
      const chain = {
        select(_cols: string, opts?: { head?: boolean }) {
          mode = opts?.head ? "count" : "page";
          return chain;
        },
        order() {
          return chain;
        },
        range(from: number, to: number) {
          state.ranges.push([from, to]);
          return Promise.resolve(state.pages.shift());
        },
        eq(_col: string, value: string) {
          state.eqCalls.push(value);
          return Promise.resolve(mode === "count" ? state.counts.shift() : undefined);
        },
      };
      return chain;
    },
  };
  return { state, client };
});

vi.mock("../../supabase/client", () => ({ createClient: () => h.client }));

import { fetchProductCodes, generateUniqueBarcode } from "../productCodesApi";
import { isEan13 } from "../productBarcode";

beforeEach(() => {
  h.state.pages = [];
  h.state.ranges = [];
  h.state.counts = [];
  h.state.eqCalls = [];
});

describe("fetchProductCodes", () => {
  it("mengumpulkan SKU (huruf besar) dan barcode dari satu halaman", async () => {
    h.state.pages = [
      {
        data: [
          { sku: "kp-1", barcode: " 111 " },
          { sku: "KP-2", barcode: null },
        ],
        error: null,
      },
    ];
    const result = await fetchProductCodes();
    expect(result).toEqual({
      success: true,
      skus: new Set(["KP-1", "KP-2"]),
      barcodes: new Set(["111"]),
    });
  });

  it("membaca halaman berikutnya selama halaman penuh", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ sku: `S${i}`, barcode: null }));
    h.state.pages = [
      { data: full, error: null },
      { data: [{ sku: "LAST", barcode: null }], error: null },
    ];
    const result = await fetchProductCodes();
    expect(h.state.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result.success && result.skus.size).toBe(1001);
  });

  it("error database diteruskan", async () => {
    h.state.pages = [{ data: null, error: { message: "izin ditolak" } }];
    expect(await fetchProductCodes()).toEqual({ success: false, error: "izin ditolak" });
  });
});

describe("generateUniqueBarcode", () => {
  it("memakai kandidat pertama yang belum ada", async () => {
    h.state.counts = [{ count: 0, error: null }];
    const result = await generateUniqueBarcode();
    expect(result.success && isEan13(result.barcode)).toBe(true);
    expect(h.state.eqCalls).toHaveLength(1);
  });

  it("mencoba lagi kalau kandidat sudah dipakai", async () => {
    h.state.counts = [
      { count: 1, error: null },
      { count: 0, error: null },
    ];
    const result = await generateUniqueBarcode();
    expect(result.success).toBe(true);
    expect(h.state.eqCalls).toHaveLength(2);
  });

  it("menyerah setelah 5 kali bentrok", async () => {
    h.state.counts = Array.from({ length: 5 }, () => ({ count: 1, error: null }));
    const result = await generateUniqueBarcode();
    expect(result.success).toBe(false);
    expect(h.state.eqCalls).toHaveLength(5);
  });

  it("error database diteruskan", async () => {
    h.state.counts = [{ count: null, error: { message: "timeout" } }];
    expect(await generateUniqueBarcode()).toEqual({ success: false, error: "timeout" });
  });
});
