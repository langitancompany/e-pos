import { describe, expect, it } from "vitest";
import { buildReturnsReport, buildTraffic } from "../reportTraffic";

// Tanggal dibuat dengan konstruktor lokal lalu diubah ke ISO, supaya jam
// yang dibaca fungsi (waktu lokal) sama di zona waktu mana pun.
// 2 Nov 2026 = Senin, 8 Nov 2026 = Minggu.
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();

describe("buildTraffic", () => {
  it("tanpa transaksi: 24 jam kosong, puncak dan hari tersibuk null", () => {
    const report = buildTraffic([]);
    expect(report.totalCount).toBe(0);
    expect(report.totalRevenue).toBe(0);
    expect(report.peakHour).toBeNull();
    expect(report.busiestDay).toBeNull();
    expect(report.hourly).toHaveLength(24);
    expect(report.hourly[0].label).toBe("00:00");
    expect(report.hourly[23].label).toBe("23:00");
    expect(report.weekdays).toHaveLength(7);
  });

  it("mengelompokkan per jam, menghitung total dan rata-rata (dibulatkan)", () => {
    const report = buildTraffic([
      { total: 10_000, created_at: at(2, 10, 5) },
      { total: 10_001, created_at: at(2, 10, 50) },
      { total: 40_000, created_at: at(2, 14, 0) },
    ]);
    expect(report.totalCount).toBe(3);
    expect(report.totalRevenue).toBe(60_001);
    expect(report.hourly[10]).toMatchObject({
      count: 2,
      revenue: 20_001,
      averageSpend: 10_001,
    });
    expect(report.hourly[14].averageSpend).toBe(40_000);
    expect(report.hourly[3].averageSpend).toBe(0);
  });

  it("jam puncak = jam dengan transaksi terbanyak, label rentang satu jam", () => {
    const report = buildTraffic([
      { total: 1_000, created_at: at(2, 9) },
      { total: 1_000, created_at: at(2, 13) },
      { total: 1_000, created_at: at(3, 13, 30) },
    ]);
    expect(report.peakHour).toEqual({
      hour: 13,
      label: "13:00 - 14:00",
      count: 2,
      revenue: 2_000,
    });
  });

  it("jam 23 berlabel sampai 00:00", () => {
    const report = buildTraffic([{ total: 1_000, created_at: at(2, 23, 10) }]);
    expect(report.peakHour?.label).toBe("23:00 - 00:00");
  });

  it("jumlah transaksi sama -> jam yang lebih awal yang dipilih", () => {
    const report = buildTraffic([
      { total: 1_000, created_at: at(2, 16) },
      { total: 1_000, created_at: at(2, 8) },
    ]);
    expect(report.peakHour?.hour).toBe(8);
  });

  it("hari dalam seminggu diurut Senin sampai Minggu", () => {
    const report = buildTraffic([]);
    expect(report.weekdays.map((d) => d.name)).toEqual([
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
      "Minggu",
    ]);
    expect(report.weekdays.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("hari tersibuk dihitung benar, Minggu dikenali sebagai day 0", () => {
    const report = buildTraffic([
      { total: 5_000, created_at: at(2, 10) }, // Senin
      { total: 7_000, created_at: at(8, 11) }, // Minggu
      { total: 9_000, created_at: at(8, 15) }, // Minggu
    ]);
    expect(report.busiestDay).toMatchObject({
      name: "Minggu",
      day: 0,
      count: 2,
      revenue: 16_000,
    });
    expect(report.weekdays[0]).toMatchObject({ name: "Senin", count: 1 });
  });

  it("seri antar hari -> hari yang lebih awal dalam urutan Senin dulu", () => {
    const report = buildTraffic([
      { total: 1_000, created_at: at(8, 10) }, // Minggu
      { total: 1_000, created_at: at(2, 10) }, // Senin
    ]);
    expect(report.busiestDay?.name).toBe("Senin");
  });

  it("tanggal tidak valid dilewati, tidak merusak total", () => {
    const report = buildTraffic([
      { total: 5_000, created_at: "bukan-tanggal" },
      { total: 3_000, created_at: at(2, 9) },
    ]);
    expect(report.totalCount).toBe(1);
    expect(report.totalRevenue).toBe(3_000);
  });
});

describe("buildReturnsReport", () => {
  const originals = new Map([["t1", "STR-001"]]);
  const cashiers = new Map<string, string | null>([
    ["c1", "Rina"],
    ["c2", null],
  ]);

  it("refund selalu positif; total refund dijumlahkan", () => {
    const report = buildReturnsReport(
      [
        {
          id: "r1",
          receipt_no: "RET-1",
          total: -30_000,
          created_at: "2026-11-02T03:00:00.000Z",
          cashier_id: "c1",
          void_reason: "Salah ukuran",
          related_transaction_id: "t1",
        },
        {
          id: "r2",
          receipt_no: "RET-2",
          total: -20_000,
          created_at: "2026-11-03T03:00:00.000Z",
          cashier_id: "c1",
          void_reason: null,
          related_transaction_id: "t1",
        },
      ],
      originals,
      cashiers,
    );
    expect(report.count).toBe(2);
    expect(report.totalRefund).toBe(50_000);
    expect(report.rows.every((r) => r.refund > 0)).toBe(true);
  });

  it("urut dari yang terbaru", () => {
    const report = buildReturnsReport(
      [
        { id: "lama", receipt_no: "A", total: -1, created_at: "2026-11-01T00:00:00.000Z", cashier_id: null, void_reason: null, related_transaction_id: null },
        { id: "baru", receipt_no: "B", total: -1, created_at: "2026-11-05T00:00:00.000Z", cashier_id: null, void_reason: null, related_transaction_id: null },
      ],
      originals,
      cashiers,
    );
    expect(report.rows.map((r) => r.id)).toEqual(["baru", "lama"]);
  });

  it("struk asal, nama kasir, dan alasan: ada -> terisi, tidak ada -> null", () => {
    const report = buildReturnsReport(
      [
        { id: "r1", receipt_no: "RET-1", total: -1_000, created_at: "2026-11-02T00:00:00.000Z", cashier_id: "c1", void_reason: "  rusak  ", related_transaction_id: "t1" },
        { id: "r2", receipt_no: "RET-2", total: -1_000, created_at: "2026-11-01T00:00:00.000Z", cashier_id: "c2", void_reason: "   ", related_transaction_id: "tidak-ada" },
        { id: "r3", receipt_no: "RET-3", total: -1_000, created_at: "2026-10-31T00:00:00.000Z", cashier_id: null, void_reason: null, related_transaction_id: null },
      ],
      originals,
      cashiers,
    );
    const [r1, r2, r3] = report.rows;
    expect(r1).toMatchObject({ originalReceiptNo: "STR-001", cashierName: "Rina", reason: "rusak" });
    expect(r2).toMatchObject({ originalReceiptNo: null, cashierName: null, reason: null });
    expect(r3).toMatchObject({ originalReceiptNo: null, cashierName: null, reason: null });
  });

  it("tanpa retur -> laporan kosong", () => {
    expect(buildReturnsReport([], originals, cashiers)).toEqual({
      rows: [],
      count: 0,
      totalRefund: 0,
    });
  });
});
