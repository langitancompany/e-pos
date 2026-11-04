import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fungsi cetak di printLogic memakai iframe tersembunyi + window.print(). Test
// berjalan di environment "node" (tanpa DOM), jadi document/window ditiru
// secukupnya: yang diperiksa adalah HTML yang DITULIS ke iframe dan urutan
// panggilannya (write -> print -> iframe dibuang), bukan hasil render browser.
vi.mock("html-to-image", () => ({
  toJpeg: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
}));

import { toJpeg } from "html-to-image";
import {
  generateReceiptImage,
  printA6Nota,
  printBrowserTestPage,
  printThermalReceipt,
  shareReceiptViaWhatsApp,
  type ReceiptData,
} from "../printLogic";

// ── DOM tiruan ───────────────────────────────────────────────────────────────
interface FakeIframe {
  style: Record<string, string>;
  contentWindow: {
    document: {
      open: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      images: { complete: boolean; onload?: () => void; onerror?: () => void }[];
    };
    focus: ReturnType<typeof vi.fn>;
    print: ReturnType<typeof vi.fn>;
  } | null;
}

const dom = {
  created: [] as FakeIframe[],
  appended: [] as unknown[],
  removed: [] as unknown[],
  /** true -> iframe.contentWindow null (mis. WebView yang tidak mendukung). */
  noContentWindow: false,
  printThrows: false,
  images: [] as { complete: boolean; onload?: () => void; onerror?: () => void }[],
  links: [] as { href: string; download: string; click: ReturnType<typeof vi.fn> }[],
};

function installDom() {
  dom.created = [];
  dom.appended = [];
  dom.removed = [];
  dom.noContentWindow = false;
  dom.printThrows = false;
  dom.images = [];
  dom.links = [];

  const document = {
    body: {
      appendChild: (el: unknown) => dom.appended.push(el),
      removeChild: (el: unknown) => dom.removed.push(el),
    },
    createElement: (tag: string) => {
      if (tag === "iframe") {
        const el: FakeIframe = {
          style: {},
          contentWindow: dom.noContentWindow
            ? null
            : {
                document: {
                  open: vi.fn(),
                  write: vi.fn(),
                  close: vi.fn(),
                  images: dom.images,
                },
                focus: vi.fn(),
                print: vi.fn(() => {
                  if (dom.printThrows) throw new Error("print tidak didukung");
                }),
              },
        };
        dom.created.push(el);
        return el;
      }
      if (tag === "a") {
        const a = { href: "", download: "", click: vi.fn() };
        dom.links.push(a);
        return a;
      }
      return { style: { cssText: "" }, innerHTML: "" };
    },
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => cb());
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["jpg"], { type: "image/jpeg" }) })),
  );
}

/** HTML yang ditulis ke iframe pertama. */
const written = (i = 0): string => dom.created[i].contentWindow!.document.write.mock.calls[0][0];

async function flush() {
  // 250ms tunggu render + 1000ms sebelum iframe dibuang
  await vi.advanceTimersByTimeAsync(2_000);
}

const base: ReceiptData = {
  receiptNo: "LCO-STR/26/11/000001",
  createdAt: "2026-11-05T03:00:00.000Z",
  cashierName: "Sari",
  items: [
    { name: "Kaos Polos", qty: 2, price: 50_000 },
    { name: "Stiker", qty: 3, price: 1_500, subtotal: 4_000 }, // subtotal sudah diskon
  ],
  subtotal: 104_000,
  total: 104_000,
  method: "CASH",
  paidAmount: 150_000,
  changeAmount: 46_000,
};

beforeEach(() => {
  vi.useFakeTimers();
  installDom();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ───────────────────────── printThermalReceipt ─────────────────────────

describe("printThermalReceipt", () => {
  it("menulis HTML ke iframe, mencetak, lalu membuang iframe", async () => {
    printThermalReceipt(base);
    const iframe = dom.created[0];

    // iframe di luar layar tapi punya ukuran asli (bukan 0x0)
    expect(iframe.style.left).toBe("-9999px");
    expect(iframe.style.width).toBe("302px");
    expect(dom.appended).toContain(iframe);

    const doc = iframe.contentWindow!.document;
    expect(doc.open).toHaveBeenCalledTimes(1);
    expect(doc.write).toHaveBeenCalledTimes(1);
    expect(doc.close).toHaveBeenCalledTimes(1);

    // print belum dipanggil sebelum jeda render
    expect(iframe.contentWindow!.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(iframe.contentWindow!.focus).toHaveBeenCalled();
    expect(iframe.contentWindow!.print).toHaveBeenCalledTimes(1);
    expect(dom.removed).toHaveLength(0);

    await flush();
    expect(dom.removed).toEqual([iframe]);
  });

  it("memuat nomor struk, kasir, metode, dan item dengan format rupiah", () => {
    printThermalReceipt(base);
    const html = written();
    expect(html).toContain("Struk LCO-STR/26/11/000001");
    expect(html).toContain("Sari");
    expect(html).toContain("Tunai");
    expect(html).toContain("Kaos Polos");
    expect(html).toContain("2x");
    expect(html).toContain("50.000");
    expect(html).toContain("100.000"); // 2 x 50.000 dihitung kalau subtotal tak dikirim
    expect(html).toContain("1.500");
    expect(html).toContain("4.000"); // subtotal eksplisit dipakai apa adanya
    expect(html).not.toContain("4.500"); // BUKAN 3 x 1.500
    expect(html).toContain("2026"); // tanggal dari createdAt
  });

  it("ringkasan: subtotal, total, bayar, kembali", () => {
    printThermalReceipt(base);
    const html = written();
    expect(html).toContain("Subtotal");
    expect(html).toContain("104.000");
    expect(html).toContain("150.000");
    expect(html).toContain("46.000");
  });

  it("diskon dan pajak hanya dicetak kalau > 0", () => {
    printThermalReceipt(base);
    expect(written()).not.toContain("Diskon");
    expect(written()).not.toContain("Pajak");

    installDom();
    printThermalReceipt({ ...base, discount: 5_000, tax: 2_000 });
    expect(written()).toContain("-5.000");
    expect(written()).toContain("Pajak");
    expect(written()).toContain("2.000");
  });

  it("nama toko, alamat, telepon, header, footer kustom", () => {
    printThermalReceipt({
      ...base,
      storeName: "Toko Maju",
      storeAddress: "Jl. Mawar 1",
      storePhone: "021-555",
      headerText: "Selamat datang",
      footerText: "Sampai jumpa",
    });
    const html = written();
    expect(html).toContain("Toko Maju");
    expect(html).toContain("Jl. Mawar 1");
    expect(html).toContain("021-555");
    expect(html).toContain("Selamat datang");
    expect(html).toContain("Sampai jumpa");
    expect(html).not.toContain("Terima kasih atas kunjungan Anda");
  });

  it("tanpa pengaturan toko: fallback ke Langitan.co dan footer bawaan", () => {
    printThermalReceipt(base);
    const html = written();
    expect(html).toContain("Langitan.co");
    expect(html).toContain("Terima kasih atas kunjungan Anda");
    expect(html).not.toContain("Pelanggan");
    expect(html).not.toContain("CETAK ULANG");
  });

  it("nama kasir kosong ditampilkan sebagai '-'", () => {
    printThermalReceipt({ ...base, cashierName: null });
    expect(written()).toMatch(/Kasir<\/td><td class="text-right">-<\/td>/);
  });

  it("pelanggan dan label cetak ulang muncul bila ada", () => {
    printThermalReceipt({ ...base, customerName: "Budi", isReprint: true });
    expect(written()).toContain("Pelanggan");
    expect(written()).toContain("Budi");
    expect(written()).toContain("*** CETAK ULANG ***");
  });

  it("teks dari pengguna di-escape (tidak bisa menyisipkan HTML)", () => {
    printThermalReceipt({
      ...base,
      storeName: "<script>alert(1)</script>",
      customerName: 'A "B" & <C>',
      items: [{ name: "<img src=x onerror=1>", qty: 1, price: 1_000 }],
    });
    const html = written();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=1>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A &quot;B&quot; &amp; &lt;C&gt;");
  });

  it("barcode dari nomor struk dicetak di bawah", () => {
    printThermalReceipt(base);
    const html = written();
    expect(html).toContain("<svg");
    expect(html.lastIndexOf("barcode-text")).toBeGreaterThan(html.indexOf("<svg"));
  });

  it("logo merek menggantikan teks nama toko", () => {
    printThermalReceipt(
      { ...base, storeName: "Toko Maju" },
      { dataUrl: "data:image/png;base64,LOGO" } as never,
    );
    const html = written();
    expect(html).toContain('src="data:image/png;base64,LOGO"');
    expect(html).not.toContain("Toko Maju");
  });

  it("QR promosi: ikut dicetak dengan teks ajakan, dan bawaan bila teks kosong", () => {
    const qr = { dataUrl: "data:image/png;base64,QR" } as never;
    printThermalReceipt({ ...base, promoText: "Ikuti IG kami" }, null, qr);
    expect(written()).toContain('src="data:image/png;base64,QR"');
    expect(written()).toContain("Ikuti IG kami");

    installDom();
    printThermalReceipt(base, null, qr);
    expect(written()).toContain("Scan untuk ikuti kami");

    installDom();
    printThermalReceipt(base, null, null);
    expect(written()).not.toContain('class="promo-qr"');
  });

  it("kind shift_open memakai layout Buka Kasir, tanpa item/barcode", () => {
    printThermalReceipt({
      ...base,
      kind: "shift_open",
      openingCash: 200_000,
      total: 0,
    });
    const html = written();
    expect(html).toContain("BUKA KASIR");
    expect(html).toContain("MODAL AWAL KAS");
    expect(html).toContain("Rp 200.000");
    expect(html).toContain("BUKAN BUKTI PENJUALAN");
    expect(html).not.toContain("Kaos Polos");
    expect(html).not.toContain("<svg");
  });

  it("shift_open tanpa openingCash memakai total", () => {
    printThermalReceipt({ ...base, kind: "shift_open", total: 75_000 });
    expect(written()).toContain("Rp 75.000");
  });

  it("jika iframe tidak punya document: batal, iframe dibuang, tidak crash", async () => {
    dom.noContentWindow = true;
    expect(() => printThermalReceipt(base)).not.toThrow();
    expect(dom.removed).toEqual([dom.created[0]]);
    await flush(); // tidak ada timer cetak yang tersisa
    expect(dom.removed).toHaveLength(1);
  });

  it("print() melempar error: tetap dicatat dan iframe tetap dibuang", async () => {
    dom.printThrows = true;
    printThermalReceipt(base);
    await flush();
    expect(console.error).toHaveBeenCalled();
    expect(dom.removed).toEqual([dom.created[0]]);
  });

  it("menunggu gambar logo selesai dimuat sebelum mencetak", async () => {
    const img = { complete: false } as { complete: boolean; onload?: () => void };
    dom.images.push(img);
    printThermalReceipt(base);
    const print = dom.created[0].contentWindow!.print;

    await vi.advanceTimersByTimeAsync(400);
    expect(print).not.toHaveBeenCalled(); // gambar belum selesai

    img.onload!();
    await vi.advanceTimersByTimeAsync(300);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("gambar yang tak kunjung selesai tidak menahan cetak lebih dari ±1,5 detik", async () => {
    dom.images.push({ complete: false });
    printThermalReceipt(base);
    const print = dom.created[0].contentWindow!.print;
    await vi.advanceTimersByTimeAsync(1_400);
    expect(print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("gambar gagal dimuat (onerror) tetap lanjut mencetak", async () => {
    const img = { complete: false } as { complete: boolean; onerror?: () => void };
    dom.images.push(img);
    printThermalReceipt(base);
    img.onerror!();
    await vi.advanceTimersByTimeAsync(300);
    expect(dom.created[0].contentWindow!.print).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── printA6Nota ─────────────────────────

describe("printA6Nota", () => {
  it("A6 (bawaan): ukuran kertas, judul, dan lebar iframe", () => {
    printA6Nota(base);
    const html = written();
    expect(dom.created[0].style.width).toBe("397px");
    expect(html).toContain("@page { size: A6;");
    expect(html).toContain("width: 105mm");
    expect(html).toContain("Nota LCO-STR/26/11/000001");
  });

  it("A5: ukuran kertas dan iframe lebih besar", () => {
    printA6Nota(base, "A5");
    const html = written();
    expect(dom.created[0].style.width).toBe("560px");
    expect(html).toContain("@page { size: A5;");
    expect(html).toContain("width: 148mm");
  });

  it("nama toko huruf besar, item, ringkasan, dan kembalian", () => {
    printA6Nota({ ...base, storeName: "Toko Maju", discount: 1_000, tax: 500 });
    const html = written();
    expect(html).toContain("TOKO MAJU");
    expect(html).toContain("Kaos Polos");
    expect(html).toContain("100.000");
    expect(html).toContain("4.000");
    expect(html).toContain("Total Tagihan");
    expect(html).toContain("-1.000");
    expect(html).toContain("Pajak");
    expect(html).toContain("Kembalian");
    expect(html).toContain("46.000");
  });

  it("tanpa diskon/pajak/pelanggan/cetak ulang: bagian itu tidak ada", () => {
    printA6Nota(base);
    const html = written();
    expect(html).not.toContain("Diskon");
    expect(html).not.toContain("Pajak");
    expect(html).not.toContain("Pelanggan");
    expect(html).not.toContain("SALINAN / CETAK ULANG");
    expect(html).toContain("LANGITAN.CO");
  });

  it("pelanggan dan cetak ulang tampil, dengan escape", () => {
    printA6Nota({ ...base, customerName: "<b>Budi</b>", isReprint: true });
    const html = written();
    expect(html).toContain("&lt;b&gt;Budi&lt;/b&gt;");
    expect(html).toContain("SALINAN / CETAK ULANG");
  });

  it("alur cetak: print setelah jeda, iframe dibuang kemudian", async () => {
    printA6Nota(base);
    const iframe = dom.created[0];
    expect(iframe.contentWindow!.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(iframe.contentWindow!.print).toHaveBeenCalledTimes(1);
    await flush();
    expect(dom.removed).toEqual([iframe]);
  });

  it("tanpa document iframe: batal tanpa crash", () => {
    dom.noContentWindow = true;
    expect(() => printA6Nota(base)).not.toThrow();
    expect(dom.removed).toHaveLength(1);
  });

  it("print() error tidak menggagalkan pembersihan", async () => {
    dom.printThrows = true;
    printA6Nota(base);
    await flush();
    expect(console.error).toHaveBeenCalled();
    expect(dom.removed).toHaveLength(1);
  });
});

// ───────────────────────── printBrowserTestPage ─────────────────────────

describe("printBrowserTestPage", () => {
  it("memuat nama toko dan label printer", async () => {
    printBrowserTestPage("Toko Maju", "Printer Kasir 1");
    const html = written();
    expect(html).toContain("TES PRINT");
    expect(html).toContain("Toko Maju");
    expect(html).toContain("Printer: Printer Kasir 1");
    await vi.advanceTimersByTimeAsync(300);
    expect(dom.created[0].contentWindow!.print).toHaveBeenCalledTimes(1);
    await flush();
    expect(dom.removed).toHaveLength(1);
  });

  it("nama toko kosong -> Langitan.co, label di-escape", () => {
    printBrowserTestPage("", "<Epson>");
    const html = written();
    expect(html).toContain("Langitan.co");
    expect(html).toContain("&lt;Epson&gt;");
  });

  it("tanpa document iframe: batal tanpa crash", () => {
    dom.noContentWindow = true;
    expect(() => printBrowserTestPage("A", "B")).not.toThrow();
    expect(dom.removed).toHaveLength(1);
  });
});

// ───────────────────────── generateReceiptImage ─────────────────────────

describe("generateReceiptImage", () => {
  it("menghasilkan Blob dari toJpeg dan membersihkan elemen sumber", async () => {
    const blob = await generateReceiptImage({ ...base, isReprint: true });
    expect(blob).toBeInstanceOf(Blob);
    expect(toJpeg).toHaveBeenCalledTimes(1);

    const container = dom.appended[0] as { innerHTML: string };
    expect(container.innerHTML).toContain("LANGITAN.CO");
    expect(container.innerHTML).toContain("*** CETAK ULANG ***");
    expect(container.innerHTML).toContain("Kaos Polos");
    expect(container.innerHTML).toContain("2 x 50.000");
    expect(container.innerHTML).toContain("4.000");
    // elemen off-screen dibuang setelah snapshot
    expect(dom.removed).toContain(container);
  });

  it("elemen sumber tetap dibuang walau toJpeg gagal", async () => {
    vi.mocked(toJpeg).mockRejectedValueOnce(new Error("render gagal"));
    await expect(generateReceiptImage(base)).rejects.toThrow("render gagal");
    expect(dom.removed).toContain(dom.appended[0]);
  });

  it("menolak jika dipanggil di luar browser", async () => {
    vi.unstubAllGlobals();
    await expect(generateReceiptImage(base)).rejects.toThrow(/hanya bisa dipanggil di browser/);
  });
});

// ───────────────────────── shareReceiptViaWhatsApp ─────────────────────────

describe("shareReceiptViaWhatsApp", () => {
  let open: ReturnType<typeof vi.fn>;

  function setNavigator(nav: unknown) {
    vi.stubGlobal("navigator", nav);
  }

  beforeEach(() => {
    open = vi.fn();
    vi.stubGlobal("window", { open });
    // timer palsu + rAF dipanggil sinkron -> aman
  });

  it("Web Share tersedia: bagikan file JPEG dan tidak membuka wa.me", async () => {
    const share = vi.fn(async () => {});
    setNavigator({ canShare: () => true, share });

    const res = await shareReceiptViaWhatsApp({ ...base, storeName: "Toko Maju" }, "0812");
    expect(res).toEqual({ method: "web-share" });
    expect(open).not.toHaveBeenCalled();

    const arg = (share.mock.calls[0] as unknown as [{ files: File[]; text: string; title: string }])[0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe("Struk-LCO-STR-26-11-000001.jpg"); // "/" diganti
    expect(arg.files[0].type).toBe("image/jpeg");
    expect(arg.title).toBe("Struk LCO-STR/26/11/000001");
    expect(arg.text).toContain("Toko Maju");
    expect(arg.text).toContain("LCO-STR/26/11/000001");
  });

  it("canShare ada tapi menolak file: pakai fallback unduh + wa.me", async () => {
    setNavigator({ canShare: () => false, share: vi.fn() });
    const res = await shareReceiptViaWhatsApp(base, "081234567890");
    expect(res).toEqual({ method: "download-fallback" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("fallback: unduh gambar lewat <a download> dan revoke URL setelah jeda", async () => {
    setNavigator({});
    await shareReceiptViaWhatsApp(base, "081234567890");

    const link = dom.links[0];
    expect(link.href).toBe("blob:fake");
    expect(link.download).toBe("Struk-LCO-STR-26-11-000001.jpg");
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(dom.removed).toContain(link);

    const revoke = (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL;
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
  });

  const waUrl = () => open.mock.calls[0][0] as string;

  it.each([
    ["0812-3456-7890", "https://wa.me/6281234567890"],
    ["+62 812 3456 7890", "https://wa.me/6281234567890"],
    ["6281234567890", "https://wa.me/6281234567890"],
    ["(0812) 345 678", "https://wa.me/62812345678"],
  ])("nomor %s dinormalkan ke format wa.me", async (phone, expected) => {
    setNavigator({});
    await shareReceiptViaWhatsApp(base, phone);
    expect(waUrl().startsWith(`${expected}?text=`)).toBe(true);
  });

  it("tanpa nomor: wa.me dibuka tanpa tujuan", async () => {
    setNavigator({});
    await shareReceiptViaWhatsApp(base, null);
    expect(waUrl().startsWith("https://wa.me/?text=")).toBe(true);

    open.mockClear();
    await shareReceiptViaWhatsApp(base, "");
    expect(waUrl().startsWith("https://wa.me/?text=")).toBe(true);
  });

  it("pesan wa.me ter-encode, memuat nomor struk dan catatan lampiran manual", async () => {
    setNavigator({});
    await shareReceiptViaWhatsApp({ ...base, footerText: "Makasih ya" }, "0812");
    const text = decodeURIComponent(waUrl().split("?text=")[1]);
    expect(text).toContain("LCO-STR/26/11/000001");
    expect(text).toContain("Makasih ya!");
    expect(text).toContain("dilampirkan manual");
    expect(open.mock.calls[0][1]).toBe("_blank");
    expect(open.mock.calls[0][2]).toBe("noopener,noreferrer");
  });

  it("caption bawaan: Langitan.co dan footer standar", async () => {
    setNavigator({});
    await shareReceiptViaWhatsApp(base, null);
    const text = decodeURIComponent(waUrl().split("?text=")[1]);
    expect(text).toContain("Langitan.co");
    expect(text).toContain("Terima kasih atas kunjungan Anda!");
  });
});
