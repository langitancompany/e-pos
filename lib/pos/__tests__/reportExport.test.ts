import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Excel: `downloadXlsx` (lib/pos/xlsxWriter.ts) di-mock; test membaca DATA SHEET
// yang dikirim ke sana (lihat xlsxTestUtils.ts) tanpa membuat file / unduhan.
// Fungsi ekspor async, tapi `downloadXlsx` dipanggil SINKRON sebelum `await`
// pertamanya, jadi data sheet bisa langsung dibaca setelah fungsi dipanggil.
// PDF: jspdf, html-to-image, <canvas>, dan Image ditiru; yang diuji adalah
// pemotongan gambar tinggi jadi beberapa halaman A4 dan penamaan file.
const h = vi.hoisted(() => {
  const pdf = {
    instances: [] as {
      options: unknown;
      text: ReturnType<typeof vi.fn>;
      addImage: ReturnType<typeof vi.fn>;
      addPage: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
    }[],
  };
  return { pdf };
});

vi.mock("@/lib/pos/xlsxWriter", () => ({
  downloadXlsx: vi.fn(async () => undefined),
}));

vi.mock("html-to-image", () => ({
  toPng: vi.fn(async () => "data:image/png;base64,AAAA"),
}));

vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    text = vi.fn();
    addImage = vi.fn();
    addPage = vi.fn();
    save = vi.fn();
    setFontSize = vi.fn();
    setTextColor = vi.fn();
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
      h.pdf.instances.push(this as never);
    }
  },
}));

import { downloadXlsx } from "@/lib/pos/xlsxWriter";
import {
  sheetRows,
  toWorkbook,
  type FakeWorkbook,
} from "@/lib/pos/__tests__/xlsxTestUtils";
import { toPng } from "html-to-image";
import {
  exportReportToExcel,
  exportReportToPdf,
  type ReportExcelPayload,
} from "../reportExport";

const NOW = new Date(2026, 10, 5, 9, 7); // 5 Nov 2026 09:07 (waktu lokal)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.pdf.instances.length = 0;
  vi.mocked(downloadXlsx).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ───────────────────────── Excel ─────────────────────────

const payload = (over: Partial<ReportExcelPayload> = {}): ReportExcelPayload => ({
  salesRangeLabel: "1 Nov 2026 — 5 Nov 2026",
  shiftRangeLabel: "5 Nov 2026 — 5 Nov 2026",
  receivablesRangeLabel: "Semua",
  summary: { revenue: 1_500_000, transactionCount: 12, itemsSold: 40, averageTicket: 125_000 },
  daily: [
    { date: "2026-11-04", label: "4 Nov", revenue: 700_000, transactionCount: 5 },
    { date: "2026-11-05", label: "5 Nov", revenue: 800_000, transactionCount: 7 },
  ],
  shifts: [
    {
      id: "s1",
      cashier_id: "c1",
      cashier_name: "Sari",
      opened_at: "2026-11-05T01:00:00Z",
      closed_at: "2026-11-05T09:00:00Z",
      status: "CLOSED",
      opening_cash: 200_000,
      cash_in: 50_000,
      cash_out: 20_000,
      expected_cash: 730_000,
      actual_cash: 725_000,
      difference: -5_000,
    },
    {
      id: "s2",
      cashier_id: "c2",
      cashier_name: null,
      opened_at: "2026-11-05T02:00:00Z",
      closed_at: null,
      status: "OPEN",
      opening_cash: 100_000,
      cash_in: null,
      cash_out: null,
      expected_cash: null,
      actual_cash: null,
      difference: null,
    },
  ],
  receivables: [
    {
      payment_id: "p1",
      transaction_id: "t1",
      receipt_no: "INV-1",
      customer_name: "Budi",
      amount: 300_000,
      due_date: "2026-12-01",
      is_settled: false,
      settled_at: null,
      status: "BELUM_LUNAS",
      created_at: "2026-11-01T00:00:00Z",
    },
    {
      payment_id: "p2",
      transaction_id: "t2",
      receipt_no: "INV-2",
      customer_name: null,
      amount: 150_000,
      due_date: null,
      is_settled: true,
      settled_at: "2026-11-03T05:00:00Z",
      status: "LUNAS",
      created_at: "2026-10-20T00:00:00Z",
    },
    {
      payment_id: "p3",
      transaction_id: "t3",
      receipt_no: "INV-3",
      customer_name: "Sinta",
      amount: 90_000,
      due_date: "2026-10-01",
      is_settled: false,
      settled_at: null,
      status: "JATUH_TEMPO",
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
  ...over,
});

function exportAndGetWorkbook(p = payload()) {
  exportReportToExcel(p);
  const call = vi.mocked(downloadXlsx).mock.calls[0];
  return { wb: toWorkbook(call[0]), fileName: call[1] };
}

const rowsOf = (wb: FakeWorkbook, sheet: string) => sheetRows(wb, sheet, "");

describe("exportReportToExcel", () => {
  it("menulis 1 file dengan 4 sheet berurutan", () => {
    const { wb } = exportAndGetWorkbook();
    expect(downloadXlsx).toHaveBeenCalledTimes(1);
    expect(wb.SheetNames).toEqual(["Ringkasan", "Harian-Bulanan", "Per Shift", "Piutang-Tempo"]);
  });

  it("nama file memakai tanggal & jam ekspor", () => {
    const { fileName } = exportAndGetWorkbook();
    expect(fileName).toBe("Laporan-LCO-POS_2026-11-05_0907.xlsx");
  });

  it("mengembalikan Promise yang selesai setelah file dibuat", async () => {
    await expect(exportReportToExcel(payload())).resolves.toBeUndefined();
    expect(downloadXlsx).toHaveBeenCalledTimes(1);
  });

  it("kegagalan pembuatan file diteruskan ke pemanggil, tidak ditelan", async () => {
    vi.mocked(downloadXlsx).mockRejectedValueOnce(new Error("gagal unduh"));
    await expect(exportReportToExcel(payload())).rejects.toThrow("gagal unduh");
  });

  it("Ringkasan: rentang tiap tab + angka mentah (bukan teks berformat)", () => {
    const rows = rowsOf(exportAndGetWorkbook().wb, "Ringkasan");
    expect(rows[0][0]).toBe("Laporan LCO POS");
    expect(rows[1]).toEqual(["Rentang Harian-Bulanan", "1 Nov 2026 — 5 Nov 2026"]);
    expect(rows[2]).toEqual(["Rentang Per Shift", "5 Nov 2026 — 5 Nov 2026"]);
    expect(rows[3]).toEqual(["Cakupan Piutang-Tempo", "Semua"]);
    expect(rows[4][0]).toBe("Diekspor Pada");

    const byLabel = Object.fromEntries(rows.filter((r) => r.length >= 2).map((r) => [r[0], r[1]]));
    expect(byLabel["Omzet"]).toBe(1_500_000);
    expect(typeof byLabel["Omzet"]).toBe("number");
    expect(byLabel["Jumlah Transaksi"]).toBe(12);
    expect(byLabel["Item Terjual"]).toBe(40);
    expect(byLabel["Rata-rata / Transaksi"]).toBe(125_000);
  });

  it("Harian-Bulanan: header + 1 baris per titik, omzet berupa angka", () => {
    const rows = rowsOf(exportAndGetWorkbook().wb, "Harian-Bulanan");
    expect(rows).toEqual([
      ["Tanggal", "Omzet", "Jumlah Transaksi"],
      ["4 Nov", 700_000, 5],
      ["5 Nov", 800_000, 7],
    ]);
  });

  it("Harian-Bulanan kosong: hanya header", () => {
    const rows = rowsOf(exportAndGetWorkbook(payload({ daily: [] })).wb, "Harian-Bulanan");
    expect(rows).toEqual([["Tanggal", "Omzet", "Jumlah Transaksi"]]);
  });

  it("Per Shift: shift selesai berisi angka kas, shift terbuka berisi '-'", () => {
    const rows = rowsOf(exportAndGetWorkbook().wb, "Per Shift");
    expect(rows[0]).toEqual([
      "Kasir", "Dibuka", "Ditutup", "Status", "Modal Awal",
      "Kas Masuk", "Kas Keluar", "Kas Diharapkan", "Kas Fisik", "Selisih",
    ]);

    const closed = rows[1];
    expect(closed[0]).toBe("Sari");
    expect(closed[3]).toBe("Selesai");
    expect(closed.slice(4)).toEqual([200_000, 50_000, 20_000, 730_000, 725_000, -5_000]);

    const open = rows[2];
    expect(open[0]).toBe("-"); // kasir tanpa nama
    expect(open[2]).toBe("-"); // belum ditutup
    expect(open[3]).toBe("Belum Ditutup");
    expect(open.slice(4)).toEqual([100_000, "-", "-", "-", "-", "-"]);
  });

  it("Selisih 0 ditulis sebagai 0, bukan '-'", () => {
    const p = payload();
    p.shifts[0] = { ...p.shifts[0], difference: 0, cash_in: 0 };
    const rows = rowsOf(exportAndGetWorkbook(p).wb, "Per Shift");
    expect(rows[1][9]).toBe(0);
    expect(rows[1][5]).toBe(0);
  });

  it("Piutang-Tempo: label status teks polos, nominal angka, tanggal kosong '-'", () => {
    const rows = rowsOf(exportAndGetWorkbook().wb, "Piutang-Tempo");
    expect(rows[0]).toEqual(["Struk", "Pelanggan", "Jatuh Tempo", "Nominal", "Status", "Dilunasi Pada"]);

    expect(rows[1][0]).toBe("INV-1");
    expect(rows[1][1]).toBe("Budi");
    expect(rows[1][3]).toBe(300_000);
    expect(rows[1][4]).toBe("Belum Lunas");
    expect(rows[1][5]).toBe("-");

    expect(rows[2][1]).toBe("-"); // tanpa nama pelanggan
    expect(rows[2][2]).toBe("-"); // tanpa jatuh tempo
    expect(rows[2][4]).toBe("Lunas");
    expect(rows[2][5]).not.toBe("-"); // ada tanggal pelunasan

    expect(rows[3][4]).toBe("Jatuh Tempo");
  });

  it("jatuh tempo 'YYYY-MM-DD' tidak mundur sehari (tidak diparse sebagai UTC)", () => {
    const rows = rowsOf(exportAndGetWorkbook().wb, "Piutang-Tempo");
    // 2026-12-01 harus tetap tanggal 1, apa pun zona waktu mesin
    expect(String(rows[1][2])).toMatch(/\b1\b/);
    expect(String(rows[1][2])).toMatch(/2026/);
  });

  it("jatuh tempo tidak valid -> '-'", () => {
    const p = payload();
    p.receivables[0] = { ...p.receivables[0], due_date: "bukan-tanggal" };
    const rows = rowsOf(exportAndGetWorkbook(p).wb, "Piutang-Tempo");
    expect(rows[1][2]).toBe("-");
  });

  it("semua data kosong: tetap menghasilkan 4 sheet berisi header", () => {
    const { wb } = exportAndGetWorkbook(payload({ daily: [], shifts: [], receivables: [] }));
    expect(wb.SheetNames).toHaveLength(4);
    expect(rowsOf(wb, "Per Shift")).toHaveLength(1);
    expect(rowsOf(wb, "Piutang-Tempo")).toHaveLength(1);
  });
});

// ───────────────────────── PDF ─────────────────────────

function installPdfDom(opts: { imageWidth: number; imageHeight: number; canvas?: boolean; imageError?: boolean }) {
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
  const canvases: { width: number; height: number }[] = [];

  class FakeImage {
    width = opts.imageWidth;
    height = opts.imageHeight;
    onload?: () => void;
    onerror?: () => void;
    set src(_v: string) {
      queueMicrotask(() => (opts.imageError ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("tak terduga: " + tag);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => (opts.canvas === false ? null : ctx),
        toDataURL: () => "data:image/png;base64,SLICE",
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return { ctx, canvases };
}

const pdfInstance = () => h.pdf.instances[0] as unknown as {
  options: unknown;
  text: ReturnType<typeof vi.fn>;
  addImage: ReturnType<typeof vi.fn>;
  addPage: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

const el = {} as HTMLElement;
const opts = { title: "Laporan Penjualan", dateRangeLabel: "1 — 5 Nov 2026" };

describe("exportReportToPdf", () => {
  it("snapshot dengan latar putih & pixelRatio 2 (supaya tidak hitam di dark mode)", async () => {
    installPdfDom({ imageWidth: 800, imageHeight: 500 });
    await exportReportToPdf(el, opts);
    expect(toPng).toHaveBeenCalledWith(el, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
    });
  });

  it("PDF A4 potrait (mm), judul & rentang tanggal ditulis, nama file dengan tanggal ekspor", async () => {
    installPdfDom({ imageWidth: 800, imageHeight: 500 });
    await exportReportToPdf(el, opts);
    const pdf = pdfInstance();
    expect(pdf.options).toEqual({ orientation: "portrait", unit: "mm", format: "a4" });
    expect(pdf.text).toHaveBeenCalledWith("Laporan Penjualan", 10, 14);
    expect(pdf.text).toHaveBeenCalledWith("1 — 5 Nov 2026", 10, 19);
    expect(pdf.save).toHaveBeenCalledWith("Laporan-LCO-POS_2026-11-05_0907.pdf");
  });

  it("gambar pendek: 1 halaman, lebar penuh area cetak (190mm), di bawah judul", async () => {
    installPdfDom({ imageWidth: 800, imageHeight: 500 });
    await exportReportToPdf(el, opts);
    const pdf = pdfInstance();
    expect(pdf.addPage).not.toHaveBeenCalled();
    expect(pdf.addImage).toHaveBeenCalledTimes(1);

    const [, format, x, y, w, hMm] = pdf.addImage.mock.calls[0];
    expect(format).toBe("PNG");
    expect(x).toBe(10);
    expect(y).toBe(23); // margin + 13 (ruang judul)
    expect(w).toBe(190);
    expect(hMm).toBeCloseTo(500 * (190 / 800), 5);
  });

  it("gambar tinggi dipotong jadi beberapa halaman, tidak diperkecil", async () => {
    const { canvases } = installPdfDom({ imageWidth: 800, imageHeight: 3000 });
    await exportReportToPdf(el, opts);
    const pdf = pdfInstance();

    expect(pdf.addImage).toHaveBeenCalledTimes(3);
    expect(pdf.addPage).toHaveBeenCalledTimes(2);

    const mmPerPx = 190 / 800;
    const heights = pdf.addImage.mock.calls.map((c) => c[5] as number);
    // seluruh gambar tercakup tepat sekali
    expect(heights.reduce((a, b) => a + b, 0)).toBeCloseTo(3000 * mmPerPx, 4);
    // halaman 1 lebih pendek (ada judul): 265mm; berikutnya 277mm
    expect(heights[0]).toBeCloseTo(265, 4);
    expect(heights[1]).toBeCloseTo(277, 4);
    expect(Math.max(...heights)).toBeLessThanOrEqual(277 + 1e-6);

    // halaman lanjutan dimulai dari margin atas
    expect(pdf.addImage.mock.calls[0][3]).toBe(23);
    expect(pdf.addImage.mock.calls[1][3]).toBe(10);
    expect(pdf.addImage.mock.calls[2][3]).toBe(10);
    // satu canvas dipakai ulang
    expect(canvases).toHaveLength(1);
  });

  it("tiap potongan menggambar bagian gambar yang berurutan tanpa celah", async () => {
    const { ctx } = installPdfDom({ imageWidth: 800, imageHeight: 3000 });
    await exportReportToPdf(el, opts);

    let expectedStart = 0;
    for (const call of ctx.drawImage.mock.calls) {
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = call as number[];
      expect(sx).toBe(0);
      expect(sy).toBeCloseTo(expectedStart, 5);
      expect(sw).toBe(800);
      expect(dx).toBe(0);
      expect(dy).toBe(0);
      expect(dw).toBe(800);
      expect(dh).toBe(sh);
      expectedStart += sh;
    }
    expect(expectedStart).toBeCloseTo(3000, 5);
  });

  it("gagal jika <canvas> tidak didukung", async () => {
    installPdfDom({ imageWidth: 800, imageHeight: 500, canvas: false });
    await expect(exportReportToPdf(el, opts)).rejects.toThrow(/tidak mendukung <canvas>/);
    expect(pdfInstance().save).not.toHaveBeenCalled();
  });

  it("gagal jika gambar hasil render tidak bisa dimuat", async () => {
    installPdfDom({ imageWidth: 800, imageHeight: 500, imageError: true });
    await expect(exportReportToPdf(el, opts)).rejects.toThrow(/Gagal memuat gambar hasil render/);
  });

  it("error dari html-to-image diteruskan", async () => {
    installPdfDom({ imageWidth: 800, imageHeight: 500 });
    vi.mocked(toPng).mockRejectedValueOnce(new Error("elemen tidak terlihat"));
    await expect(exportReportToPdf(el, opts)).rejects.toThrow("elemen tidak terlihat");
  });
});
