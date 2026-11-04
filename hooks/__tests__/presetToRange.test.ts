import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hooks/useReports membuat klien Supabase saat dimuat (bersama hook lain yang
// diimpornya), jadi klien itu diganti tiruan kosong. Yang diuji hanya fungsi
// murni presetToRange().
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { presetToRange } from "../useReports";

// Kamis, 5 Nov 2026 10:30 waktu lokal
const NOW = new Date(2026, 10, 5, 10, 30, 15, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const hms = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];

describe("presetToRange", () => {
  it("today: 00:00 sampai 23:59:59.999 hari ini", () => {
    const r = presetToRange("today");
    expect(ymd(r.start)).toEqual([2026, 11, 5]);
    expect(hms(r.start)).toEqual([0, 0, 0, 0]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
    expect(hms(r.end)).toEqual([23, 59, 59, 999]);
  });

  it("7d: 7 hari termasuk hari ini (mulai 6 hari lalu)", () => {
    const r = presetToRange("7d");
    expect(ymd(r.start)).toEqual([2026, 10, 30]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
  });

  it("30d: 30 hari termasuk hari ini, melintasi batas bulan", () => {
    const r = presetToRange("30d");
    expect(ymd(r.start)).toEqual([2026, 10, 7]);
    expect(hms(r.start)).toEqual([0, 0, 0, 0]);
  });

  it("this_month: tanggal 1 sampai akhir hari ini", () => {
    const r = presetToRange("this_month");
    expect(ymd(r.start)).toEqual([2026, 11, 1]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
    expect(hms(r.end)).toEqual([23, 59, 59, 999]);
  });

  it("last_month: tanggal 1 sampai hari terakhir bulan lalu", () => {
    const r = presetToRange("last_month");
    expect(ymd(r.start)).toEqual([2026, 10, 1]);
    expect(ymd(r.end)).toEqual([2026, 10, 31]);
    expect(hms(r.end)).toEqual([23, 59, 59, 999]);
  });

  it("last_month di bulan Januari: mundur ke Desember tahun sebelumnya", () => {
    vi.setSystemTime(new Date(2026, 0, 15, 12));
    const r = presetToRange("last_month");
    expect(ymd(r.start)).toEqual([2025, 12, 1]);
    expect(ymd(r.end)).toEqual([2025, 12, 31]);
  });

  it("last_month: bulan lalu Februari (tahun biasa vs kabisat)", () => {
    vi.setSystemTime(new Date(2026, 2, 10)); // Maret 2026 -> Feb 2026 (28 hari)
    expect(ymd(presetToRange("last_month").end)).toEqual([2026, 2, 28]);
    vi.setSystemTime(new Date(2028, 2, 10)); // Maret 2028 -> Feb 2028 (29 hari)
    expect(ymd(presetToRange("last_month").end)).toEqual([2028, 2, 29]);
  });

  it("custom: batas dinormalkan ke awal & akhir hari", () => {
    const r = presetToRange("custom", {
      start: new Date(2026, 8, 1, 15, 45),
      end: new Date(2026, 8, 18, 3, 10),
    });
    expect(ymd(r.start)).toEqual([2026, 9, 1]);
    expect(hms(r.start)).toEqual([0, 0, 0, 0]);
    expect(ymd(r.end)).toEqual([2026, 9, 18]);
    expect(hms(r.end)).toEqual([23, 59, 59, 999]);
  });

  it("custom tanpa rentang: error", () => {
    expect(() => presetToRange("custom")).toThrow(/customRange wajib diisi/);
  });

  it("preset tak dikenal: jatuh ke 'hari ini'", () => {
    const r = presetToRange("entah" as never);
    expect(ymd(r.start)).toEqual([2026, 11, 5]);
    expect(ymd(r.end)).toEqual([2026, 11, 5]);
  });

  it("tidak mengubah objek rentang custom yang dikirim", () => {
    const start = new Date(2026, 8, 1, 15, 45);
    const end = new Date(2026, 8, 18, 3, 10);
    presetToRange("custom", { start, end });
    expect(start.getHours()).toBe(15);
    expect(end.getHours()).toBe(3);
  });
});
