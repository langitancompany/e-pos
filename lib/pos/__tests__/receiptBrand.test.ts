import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// loadReceiptBrand() menggambar ke <canvas>. Di sini canvas, Image, dan
// document.fonts ditiru: lebar teks = jumlah huruf x ukuran font x 0,5, dan
// piksel hasil gambar diatur oleh test. Yang diuji adalah tata letak kepala
// struk, aturan pecah baris/kecilkan huruf, konversi ke bitmap 1-bit ESC/POS,
// cache, dan fallback ke null — bukan tampilan huruf sebenarnya.
type Brand = NonNullable<Awaited<ReturnType<typeof import("../receiptBrand").loadReceiptBrand>>>;

interface FillText { text: string; x: number; y: number; font: string }
interface Ctx {
  font: string;
  fillTexts: FillText[];
  drawImage: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  measureText(t: string): { width: number };
  fillText(t: string, x: number, y: number): void;
  [k: string]: unknown;
}

const env = {
  canvases: [] as { width: number; height: number; ctx: Ctx | null; toDataURL: () => string }[],
  imageCount: 0,
  logo: { w: 300, h: 100, fail: false } as { w: number; h: number; fail: boolean },
  /** fungsi pewarna piksel: kembalikan nilai abu-abu 0-255 untuk (x,y). */
  shade: (() => 255) as (x: number, y: number) => number,
  noContext: false,
  fontsReject: false,
  toDataURLThrows: false,
};

function makeCtx(): Ctx {
  const ctx: Ctx = {
    font: "",
    fillTexts: [],
    drawImage: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = env.shade(x, y);
          const i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
      return { data };
    }),
    measureText(t: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: t.length * px * 0.5 };
    },
    fillText(t: string, x: number, y: number) {
      ctx.fillTexts.push({ text: t, x, y, font: ctx.font });
    },
  };
  return ctx;
}

function installDom() {
  env.canvases = [];
  env.imageCount = 0;
  env.logo = { w: 300, h: 100, fail: false };
  env.shade = () => 255;
  env.noContext = false;
  env.fontsReject = false;
  env.toDataURLThrows = false;

  class FakeImage {
    naturalWidth = env.logo.w;
    naturalHeight = env.logo.h;
    onload?: () => void;
    onerror?: () => void;
    constructor() {
      env.imageCount++;
    }
    set src(_v: string) {
      queueMicrotask(() => (env.logo.fail ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("document", {
    documentElement: {},
    fonts: { load: vi.fn(async () => { if (env.fontsReject) throw new Error("font"); }) },
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("tak terduga " + tag);
      const canvas = {
        width: 0,
        height: 0,
        ctx: null as Ctx | null,
        getContext() {
          if (env.noContext) return null;
          canvas.ctx ??= makeCtx();
          return canvas.ctx;
        },
        toDataURL: () => {
          if (env.toDataURLThrows) throw new Error("canvas tainted");
          return "data:image/png;base64,HI";
        },
      };
      env.canvases.push(canvas);
      return canvas;
    },
  });
}

async function load(name?: string): Promise<Brand | null> {
  const mod = await import("../receiptBrand");
  return mod.loadReceiptBrand(name);
}

/** Canvas cetak (384 dot) = canvas ke-3 (ke-1 ukur, ke-2 preview, ke-3 printer). */
const hiCanvas = () => env.canvases[1];
const printCanvas = () => env.canvases[2];
const measureCanvas = () => env.canvases[0];
const texts = () => printCanvas().ctx!.fillTexts;

beforeEach(() => {
  vi.resetModules();
  installDom();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadReceiptBrand — hasil dasar", () => {
  it("di luar browser -> null", async () => {
    vi.unstubAllGlobals();
    expect(await load("Toko")).toBeNull();
  });

  it("lebar 384 dot, tinggi kelipatan 24 (tiap pita penuh)", async () => {
    const b = (await load("Langitan.co Store"))!;
    expect(b.width).toBe(384);
    expect(b.height % 24).toBe(0);
    expect(b.height).toBeGreaterThan(0);
    expect(printCanvas().width).toBe(384);
    expect(printCanvas().height).toBe(b.height);
  });

  it("preview HTML digambar 3x lebih besar dan di-scale 3x", async () => {
    const b = (await load("Toko Maju"))!;
    expect(b.dataUrl).toBe("data:image/png;base64,HI");
    expect(hiCanvas().width).toBe(384 * 3);
    expect(hiCanvas().height).toBe(b.height * 3);
    expect(hiCanvas().ctx!.scale).toHaveBeenCalledWith(3, 3);
  });

  it("raster: satu perintah GS v 0 per pita 24 baris (48 byte per baris)", async () => {
    const b = (await load("Toko Maju"))!;
    const bands = b.height / 24;
    const bandSize = 8 + 24 * 48;
    expect(b.raster).toHaveLength(bands * bandSize);
    for (let i = 0; i < bands; i++) {
      const o = i * bandSize;
      expect(Array.from(b.raster.slice(o, o + 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 24, 0]);
    }
  });
});

describe("loadReceiptBrand — konversi ke bitmap 1-bit", () => {
  it("semua putih -> semua bit 0", async () => {
    env.shade = () => 255;
    const b = (await load("Toko"))!;
    const data = Array.from(b.raster).filter((_, i) => i % (8 + 24 * 48) >= 8);
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it("semua hitam -> semua bit 1", async () => {
    env.shade = () => 0;
    const b = (await load("Toko"))!;
    const bandSize = 8 + 24 * 48;
    for (let i = 0; i < b.height / 24; i++) {
      const band = b.raster.slice(i * bandSize + 8, (i + 1) * bandSize);
      expect(band.every((v) => v === 0xff)).toBe(true);
    }
  });

  it("satu piksel hitam di (x=9, y=1) menyalakan bit yang tepat", async () => {
    env.shade = (x, y) => (x === 9 && y === 1 ? 0 : 255);
    const b = (await load("Toko"))!;
    const data = b.raster.slice(8, 8 + 24 * 48);
    const idx = 1 * 48 + (9 >> 3); // baris 1, byte ke-1
    expect(data[idx]).toBe(0x80 >> (9 & 7)); // 0x40
    expect(data.filter((v) => v !== 0)).toHaveLength(1);
  });

  it("ambang: luminans < 170 hitam, >= 170 putih", async () => {
    env.shade = (x) => (x === 0 ? 169 : x === 1 ? 170 : 255);
    const b = (await load("Toko"))!;
    const firstByte = b.raster[8];
    expect(firstByte & 0x80).toBe(0x80); // x=0 (169) hitam
    expect(firstByte & 0x40).toBe(0); // x=1 (170) putih
  });
});

describe("loadReceiptBrand — tulisan merek", () => {
  it("'Langitan.co Store' muat satu baris: bagian awal + akhiran, baseline sama", async () => {
    await load("Langitan.co Store");
    const t = texts();
    expect(t.map((x) => x.text)).toEqual(["Langitan.co", " Store"]);
    expect(t[0].y).toBe(t[1].y);
    expect(t[0].font).toMatch(/^normal 800 35px/); // tebal
    expect(t[1].font).toMatch(/^italic 500 35px/); // miring
    // teks bersambung: akhiran mulai tepat di ujung bagian awal
    expect(t[1].x).toBeCloseTo(t[0].x + "Langitan.co".length * 35 * 0.5, 0);
  });

  it("nama tanpa spasi: ' Store' ditambahkan otomatis", async () => {
    await load("Langitan.co");
    expect(texts().map((x) => x.text)).toEqual(["Langitan.co", " Store"]);
  });

  it("nama kosong atau tidak diberikan: pakai 'Langitan.co Store'", async () => {
    await load(undefined);
    expect(texts().map((x) => x.text)).toEqual(["Langitan.co", " Store"]);
  });

  it("nama berspasi dipakai apa adanya (bagian setelah spasi pertama = akhiran)", async () => {
    await load("Toko Maju");
    expect(texts().map((x) => x.text)).toEqual(["Toko", " Maju"]);
  });

  it("terlalu lebar untuk satu baris: akhiran pindah ke baris 2 tanpa mengecilkan huruf", async () => {
    // akhiran " Edisi Premium" = 14 huruf -> total 11+14 = 25 huruf x 17,5 = 437 > 360
    await load("Langitan.co Edisi Premium");
    const t = texts();
    expect(t.map((x) => x.text)).toEqual(["Langitan.co", "Edisi Premium"]); // spasi depan dibuang
    expect(t[1].y).toBeGreaterThan(t[0].y);
    expect(t[0].font).toMatch(/35px/);
    expect(t[1].font).toMatch(/35px/);
  });

  it("satu baris saja sudah kelewat lebar: huruf dikecilkan agar muat", async () => {
    await load("Langitan.co Edisi Premium Sangat Panjang Sekali");
    const sizes = texts().map((x) => Number(/(\d+)px/.exec(x.font)![1]));
    expect(Math.max(...sizes)).toBeLessThan(35);
    expect(Math.min(...sizes)).toBeGreaterThan(0);
  });

  it("tiap baris teks dipusatkan di kertas 384 dot", async () => {
    await load("Langitan.co Edisi Premium");
    const [l1, l2] = texts();
    const w1 = l1.text.length * 35 * 0.5;
    const w2 = l2.text.length * 35 * 0.5;
    expect(l1.x).toBe(Math.round((384 - w1) / 2));
    expect(l2.x).toBe(Math.round((384 - w2) / 2));
  });

  it("dua baris -> tinggi bitmap lebih besar dari satu baris", async () => {
    const one = (await load("Langitan.co Store"))!;
    vi.resetModules();
    installDom();
    const two = (await load("Langitan.co Edisi Premium"))!;
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("latar digambar putih dulu supaya transparansi PNG rata", async () => {
    await load("Toko");
    expect(printCanvas().ctx!.fillRect).toHaveBeenCalledWith(0, 0, 384, expect.any(Number));
  });
});

describe("loadReceiptBrand — ikon", () => {
  it("ikon landscape 300x100 diskalakan ke 150x50 dan dipusatkan di atas", async () => {
    env.logo = { w: 300, h: 100, fail: false };
    await load("Toko");
    const call = printCanvas().ctx!.drawImage.mock.calls[0];
    expect(call.slice(1)).toEqual([Math.round((384 - 150) / 2), 6, 150, 50]);
  });

  it("ikon persegi 100x100 dibatasi tinggi maksimum (56)", async () => {
    env.logo = { w: 100, h: 100, fail: false };
    await load("Toko");
    const [, x, y, w, h] = printCanvas().ctx!.drawImage.mock.calls[0];
    expect([w, h]).toEqual([56, 56]);
    expect(x).toBe(Math.round((384 - 56) / 2));
    expect(y).toBe(6);
  });

  it("ikon gagal dimuat: tetap berhasil tanpa ikon, dengan peringatan", async () => {
    env.logo.fail = true;
    const b = await load("Toko");
    expect(b).not.toBeNull();
    expect(printCanvas().ctx!.drawImage).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("ikon berukuran 0 dianggap tidak ada", async () => {
    env.logo = { w: 0, h: 0, fail: false };
    await load("Toko");
    expect(printCanvas().ctx!.drawImage).not.toHaveBeenCalled();
  });

  it("tanpa ikon, bitmap lebih pendek dibanding dengan ikon", async () => {
    const withLogo = (await load("Toko"))!;
    vi.resetModules();
    installDom();
    env.logo.fail = true;
    const without = (await load("Toko"))!;
    expect(without.height).toBeLessThan(withLogo.height);
  });
});

describe("loadReceiptBrand — cache & ketahanan", () => {
  it("nama yang sama dari cache (tidak memuat ulang ikon / membuat canvas baru)", async () => {
    const mod = await import("../receiptBrand");
    const a = await mod.loadReceiptBrand("Toko Maju");
    const canvasCount = env.canvases.length;
    const b = await mod.loadReceiptBrand("Toko Maju");
    expect(b).toBe(a);
    expect(env.imageCount).toBe(1);
    expect(env.canvases).toHaveLength(canvasCount);
  });

  it("nama berbeda menghasilkan kepala struk baru", async () => {
    const mod = await import("../receiptBrand");
    const a = await mod.loadReceiptBrand("Toko Maju");
    const b = await mod.loadReceiptBrand("Toko Mundur");
    expect(b).not.toBe(a);
    expect(env.imageCount).toBe(2);
  });

  it("'Toko' dan 'Toko Store' berbagi cache (sama-sama akhirnya 'Toko Store')", async () => {
    const mod = await import("../receiptBrand");
    const a = await mod.loadReceiptBrand("Toko");
    const b = await mod.loadReceiptBrand("Toko Store");
    expect(b).toBe(a);
  });

  it("font gagal dimuat: tetap menggambar dengan font cadangan", async () => {
    env.fontsReject = true;
    expect(await load("Toko")).not.toBeNull();
  });

  it("memuat font normal & miring sebelum menggambar", async () => {
    await load("Toko");
    const loadFont = (document as unknown as { fonts: { load: ReturnType<typeof vi.fn> } }).fonts.load;
    const fonts = loadFont.mock.calls.map((c) => c[0] as string);
    expect(fonts.some((f) => f.startsWith("normal 800"))).toBe(true);
    expect(fonts.some((f) => f.startsWith("italic 500"))).toBe(true);
  });

  it("canvas tidak didukung -> null (cetak tetap jalan tanpa logo)", async () => {
    env.noContext = true;
    expect(await load("Toko")).toBeNull();
  });

  it("error saat menggambar (mis. canvas tainted) -> null, bukan melempar", async () => {
    env.toDataURLThrows = true;
    await expect(load("Toko")).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("gagal tidak disimpan di cache: percobaan berikutnya bisa berhasil", async () => {
    const mod = await import("../receiptBrand");
    env.toDataURLThrows = true;
    expect(await mod.loadReceiptBrand("Toko")).toBeNull();
    env.toDataURLThrows = false;
    expect(await mod.loadReceiptBrand("Toko")).not.toBeNull();
  });

  it("kanvas ukur dipakai untuk pengukuran teks", async () => {
    await load("Toko");
    expect(measureCanvas().ctx).not.toBeNull();
  });
});
