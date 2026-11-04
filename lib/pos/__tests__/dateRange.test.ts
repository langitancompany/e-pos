import { describe, expect, it } from "vitest";
import {
  addDays,
  chunk,
  dateKey,
  endOfDay,
  presetToRange,
  shortLabel,
  startOfDay,
} from "../dateRange";

// Semua tanggal dibuat dengan konstruktor LOKAL, jadi hasilnya sama di zona
// waktu mana pun (Jakarta, UTC, Los Angeles).
const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const hms = (d: Date) => [
  d.getHours(),
  d.getMinutes(),
  d.getSeconds(),
  d.getMilliseconds(),
];

// Kamis, 5 Nov 2026 10:30:15 waktu lokal
const NOW = new Date(2026, 10, 5, 10, 30, 15, 0);

describe("startOfDay / endOfDay", () => {
  it("startOfDay: 00:00:00.000 di tanggal yang sama", () => {
    const r = startOfDay(new Date(2026, 10, 5, 15, 45, 12, 345));
    expect(ymd(r)).toEqual([2026, 11, 5]);
    expect(hms(r)).toEqual([0, 0, 0, 0]);
  });

  it("endOfDay: 23:59:59.999 di tanggal yang sama", () => {
    const r = endOfDay(new Date(2026, 10, 5, 0, 0, 0, 0));
    expect(ymd(r)).toEqual([2026, 11, 5]);
    expect(hms(r)).toEqual([23, 59, 59, 999]);
  });

  it("tidak mengubah objek Date yang dikirim", () => {
    const original = new Date(2026, 10, 5, 15, 45);
    startOfDay(original);
    endOfDay(original);
    expect(hms(original)).toEqual([15, 45, 0, 0]);
  });
});

describe("addDays", () => {
  it("menambah hari melintasi batas bulan dan tahun", () => {
    expect(ymd(addDays(new Date(2026, 9, 31), 1))).toEqual([2026, 11, 1]);
    expect(ymd(addDays(new Date(2026, 11, 31), 1))).toEqual([2027, 1, 1]);
  });

  it("mengurangi hari dengan nilai negatif", () => {
    expect(ymd(addDays(new Date(2026, 10, 5), -6))).toEqual([2026, 10, 30]);
    expect(ymd(addDays(new Date(2026, 0, 1), -1))).toEqual([2025, 12, 31]);
  });

  it("tahun kabisat: 28 Feb 2028 + 1 = 29 Feb", () => {
    expect(ymd(addDays(new Date(2028, 1, 28), 1))).toEqual([2028, 2, 29]);
    expect(ymd(addDays(new Date(2026, 1, 28), 1))).toEqual([2026, 3, 1]);
  });

  it("jam lokal dipertahankan walau melewati pergantian DST (Los Angeles 8 Mar 2026)", () => {
    const r = addDays(new Date(2026, 2, 7, 0, 0, 0, 0), 1);
    expect(ymd(r)).toEqual([2026, 3, 8]);
    expect(hms(r)).toEqual([0, 0, 0, 0]);
    const r2 = addDays(new Date(2026, 2, 7, 0, 0, 0, 0), 2);
    expect(ymd(r2)).toEqual([2026, 3, 9]);
    expect(hms(r2)).toEqual([0, 0, 0, 0]);
  });

  it("tidak mengubah objek Date yang dikirim", () => {
    const original = new Date(2026, 10, 5);
    addDays(original, 10);
    expect(ymd(original)).toEqual([2026, 11, 5]);
  });
});

describe("dateKey", () => {
  it("format YYYY-MM-DD dengan nol di depan", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("memakai tanggal LOKAL: 00:30 tetap tanggal itu (bukan mundur ke kemarin versi UTC)", () => {
    expect(dateKey(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 0, 5, 23, 59, 59, 999))).toBe("2026-01-05");
  });
});

describe("shortLabel", () => {
  it("tanggal tanpa nol di depan + nama bulan singkat bahasa Indonesia", () => {
    expect(shortLabel(new Date(2026, 10, 5))).toBe("5 Nov");
    expect(shortLabel(new Date(2026, 9, 17))).toBe("17 Okt");
    expect(shortLabel(new Date(2026, 8, 1))).toBe("1 Sep");
  });
});

describe("chunk", () => {
  it("array kosong menghasilkan array kosong", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("kelipatan pas dibagi rata", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("sisa masuk potongan terakhir", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("ukuran lebih besar dari isi: satu potongan", () => {
    expect(chunk([1, 2, 3], 150)).toEqual([[1, 2, 3]]);
  });

  it("150 id -> 1 potongan, 151 id -> 2 potongan (batas .in() dashboard)", () => {
    const ids = Array.from({ length: 151 }, (_, i) => `id-${i}`);
    expect(chunk(ids.slice(0, 150), 150)).toHaveLength(1);
    const two = chunk(ids, 150);
    expect(two).toHaveLength(2);
    expect(two[1]).toEqual(["id-150"]);
  });

  it("tidak mengubah array asal", () => {
    const src = [1, 2, 3];
    chunk(src, 2);
    expect(src).toEqual([1, 2, 3]);
  });
});

describe("presetToRange (now disuntik)", () => {
  it("today: 00:00 sampai 23:59:59.999 hari ini", () => {
    const r = presetToRange("today", undefined, NOW);
    expect(ymd(r.start)).toEqual([2026, 11, 5]);
    expect(hms(r.start)).toEqual([0, 0, 0, 0]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
    expect(hms(r.end)).toEqual([23, 59, 59, 999]);
  });

  it("7d: 7 hari termasuk hari ini", () => {
    const r = presetToRange("7d", undefined, NOW);
    expect(ymd(r.start)).toEqual([2026, 10, 30]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
  });

  it("30d: 30 hari termasuk hari ini", () => {
    const r = presetToRange("30d", undefined, NOW);
    expect(ymd(r.start)).toEqual([2026, 10, 7]);
    expect(hms(r.start)).toEqual([0, 0, 0, 0]);
  });

  it("this_month: tanggal 1 sampai akhir hari ini", () => {
    const r = presetToRange("this_month", undefined, NOW);
    expect(ymd(r.start)).toEqual([2026, 11, 1]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
  });

  it("last_month: seluruh bulan lalu; Januari mundur ke Desember", () => {
    const r = presetToRange("last_month", undefined, NOW);
    expect(ymd(r.start)).toEqual([2026, 10, 1]);
    expect(ymd(r.end)).toEqual([2026, 10, 31]);
    const jan = presetToRange("last_month", undefined, new Date(2026, 0, 15, 12));
    expect(ymd(jan.start)).toEqual([2025, 12, 1]);
    expect(ymd(jan.end)).toEqual([2025, 12, 31]);
  });

  it("custom: batas dinormalkan ke awal & akhir hari", () => {
    const r = presetToRange(
      "custom",
      { start: new Date(2026, 8, 1, 15, 45), end: new Date(2026, 8, 18, 3, 10) },
      NOW,
    );
    expect(hms(r.start)).toEqual([0, 0, 0, 0]);
    expect(ymd(r.end)).toEqual([2026, 9, 18]);
    expect(hms(r.end)).toEqual([23, 59, 59, 999]);
  });

  it("custom tanpa rentang: error", () => {
    expect(() => presetToRange("custom", undefined, NOW)).toThrow(
      /customRange wajib diisi/,
    );
  });

  it("preset tak dikenal: jatuh ke 'hari ini'", () => {
    const r = presetToRange("entah" as never, undefined, NOW);
    expect(ymd(r.start)).toEqual([2026, 11, 5]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
  });

  it("tanpa argumen now memakai jam sekarang (perilaku lama)", () => {
    const r = presetToRange("today");
    const today = new Date();
    expect(ymd(r.start)).toEqual(ymd(today));
  });
});
