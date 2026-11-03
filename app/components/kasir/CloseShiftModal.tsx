"use client";

// ── TAMBAHAN (Tutup Sesi Kas dari layar Kasir) ── Modal hitung pecahan uang +
// modal ringkasan selisih, dipindah dari app/components/kas/KasModule.tsx.
// Sejak tombol Buka/Tutup Shift dipindah sepenuhnya ke layar Kasir, menu "Kas &
// Shift" tinggal menampilkan shift berjalan + riwayat (read-only), jadi modal
// ini sekarang cuma dipakai KasirModule.tsx.
//
// Kedua modal SENGAJA "bodoh" (tanpa state hasil): hasil close_shift disimpan
// oleh KasirModule. Alasannya, begitu shift tertutup `activeShift` jadi null dan
// KasirModule berpindah cabang render — kalau hasil disimpan di sini, modal ini
// ikut ter-unmount dan ringkasan selisih tidak sempat terlihat.
//
// Helper differenceColorClass/differenceLabel diekspor karena KasModule.tsx
// (tabel riwayat) memakai format yang sama.

import { useMemo, useRef, useState } from "react";
import { Lock, Loader2, AlertTriangle, X } from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import type { CloseShiftResult } from "@/hooks/useShifts";

// Pecahan uang tunai Rupiah yang beredar, dari besar ke kecil.
const DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100];

/** Warna teks selisih kas: nol = teal (aman), kurang = coral, lebih = mustard. */
export function differenceColorClass(difference: number | null): string {
  if (difference === null) return "text-zinc-400";
  if (difference === 0) return "text-lco-teal";
  if (difference < 0) return "text-lco-coral";
  return "text-lco-mustard";
}

export function differenceLabel(difference: number | null): string {
  if (difference === null) return "-";
  if (difference === 0) return `Pas — ${formatRupiah(0)}`;
  if (difference < 0) return `Kurang ${formatRupiah(Math.abs(difference))}`;
  return `Lebih ${formatRupiah(difference)}`;
}

// --------------------------------------------------------
// Modal: isi jumlah uang fisik (hitung per pecahan)
// --------------------------------------------------------

export function CloseShiftModal({
  onClose,
  onSubmit,
  cashMovementSummary,
}: {
  onClose: () => void;
  /**
   * Kirim total kas fisik + catatan penutupan (opsional). Dilempar Error kalau
   * gagal — pesannya ditampilkan di modal. Kalau pesannya memuat "alasan
   * selisih" (server menolak karena ada selisih tanpa catatan), kolom catatan
   * otomatis jadi wajib.
   */
  onSubmit: (actualCash: number, notes?: string) => Promise<void>;
  /**
   * ── TAMBAHAN (migration 040) ── Kas masuk/keluar yang SUDAH dicatat di shift
   * ini, hanya sebagai pengingat sebelum menghitung uang fisik. Sengaja TIDAK
   * menampilkan kas seharusnya — penutupan kas dibuat "buta".
   */
  cashMovementSummary?: {
    cashIn: number;
    cashOut: number;
    activeCount: number;
  };
}) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ── TAMBAHAN (migration 041) ── Catatan penutupan. Kolom ini wajib hanya
  // setelah server bilang ada selisih; penutupan sengaja tetap "buta" (selisih
  // tidak ditampilkan sebelum kasir mengirim hitungan).
  const [notes, setNotes] = useState("");
  const [notesRequired, setNotesRequired] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const actualCash = useMemo(() => {
    return DENOMINATIONS.reduce((total, denom) => {
      const qty = Number(counts[denom]) || 0;
      return total + denom * qty;
    }, 0);
  }, [counts]);

  const handleCountChange = (denom: number, value: string) => {
    const digitsOnly = value.replace(/[^0-9]/g, "");
    setCounts((prev) => ({ ...prev, [denom]: digitsOnly }));
  };

  const handleSubmit = async () => {
    setError(null);

    if (notesRequired && notes.trim() === "") {
      setError(
        "Isi alasan selisih di kolom catatan, atau hitung ulang uang fisik.",
      );
      notesRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(actualCash, notes.trim() || undefined);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal menutup shift.";
      if (/alasan selisih/i.test(message)) {
        // Server menolak: ada selisih tapi catatan kosong. Jangan bocorkan
        // nominalnya — cukup minta hitung ulang atau isi alasan.
        setNotesRequired(true);
        setError(
          "Uang fisik tidak sama dengan catatan sistem. Hitung ulang uangnya, atau isi alasan selisih di kolom catatan lalu tutup sesi lagi.",
        );
        setTimeout(() => notesRef.current?.focus(), 0);
      } else if (/pesanan tahan/i.test(message)) {
        setError(
          `${message} Pesanan tahan bisa dilihat lewat tombol Pending di layar Kasir.`,
        );
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4 text-lco-coral" />
            Tutup Sesi Kas
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors duration-150 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs text-zinc-500">
          Hitung uang fisik di laci per pecahan. Selisih dihitung otomatis oleh
          sistem.
        </p>

        {cashMovementSummary && (
          <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {cashMovementSummary.activeCount > 0 ? (
              <p>
                Tercatat di shift ini: kas masuk{" "}
                <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatRupiah(cashMovementSummary.cashIn)}
                </span>
                , kas keluar{" "}
                <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatRupiah(cashMovementSummary.cashOut)}
                </span>
                .
              </p>
            ) : (
              <p>Belum ada kas masuk/keluar yang dicatat di shift ini.</p>
            )}
            <p className="mt-1 text-zinc-400">
              Pastikan semua uang yang keluar atau masuk laci sudah dicatat
              sebelum menutup — shift yang sudah ditutup tidak bisa diubah.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {DENOMINATIONS.map((denom) => (
            <div key={denom} className="flex items-center gap-3">
              <span className="w-24 shrink-0 font-mono tabular-nums text-sm text-zinc-600 dark:text-zinc-400">
                {formatRupiah(denom)}
              </span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={counts[denom] ?? ""}
                onChange={(e) => handleCountChange(denom, e.target.value)}
                className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm font-mono tabular-nums text-right focus:border-lco-teal focus:outline-none focus:ring-2 focus:ring-lco-teal dark:border-zinc-700 dark:bg-zinc-950 transition-colors duration-150"
              />
              <span className="flex-1 text-right font-mono tabular-nums text-sm text-zinc-400">
                {formatRupiah(denom * (Number(counts[denom]) || 0))}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 text-sm font-semibold">
          <span>Total kas fisik</span>
          <span className="font-mono tabular-nums">
            {formatRupiah(actualCash)}
          </span>
        </div>

        <div className="mt-4">
          <label
            htmlFor="close-shift-notes"
            className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            <span>Catatan penutupan</span>
            <span
              className={notesRequired ? "text-lco-coral" : "text-zinc-400"}
            >
              {notesRequired ? "Wajib diisi" : "Opsional"}
            </span>
          </label>
          <textarea
            id="close-shift-notes"
            ref={notesRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={3}
            disabled={isSubmitting}
            placeholder={
              notesRequired
                ? "Tulis alasan selisih kas"
                : "Kendala atau catatan serah terima (boleh dikosongkan)"
            }
            className={`w-full resize-none rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:bg-zinc-950 transition-colors duration-150 ${
              notesRequired
                ? "border-lco-coral focus:border-lco-coral focus:ring-lco-coral"
                : "border-zinc-300 focus:border-lco-teal focus:ring-lco-teal dark:border-zinc-700"
            }`}
          />
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-lco-coral px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          Tutup Sesi Kas
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Modal: ringkasan selisih setelah shift ditutup
// --------------------------------------------------------

export function CloseShiftSummaryModal({
  result,
  onDone,
}: {
  result: CloseShiftResult;
  onDone: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
        <h3 className="mb-4 text-base font-semibold flex items-center gap-2">
          <Lock className="h-4 w-4 text-lco-coral" />
          Sesi Kas Ditutup
        </h3>
        <p className="mb-3 text-xs text-zinc-500">Ringkasan selisih kas:</p>

        {/* ── TAMBAHAN (migration 040) ── Rincian asal angka "Kas seharusnya".
            Baris yang nilainya 0 disembunyikan supaya ringkasan tetap pendek. */}
        <div
          className="mb-3 rounded-md border border-zinc-200 dark:border-zinc-800 p-4 space-y-1.5 text-xs"
          aria-label="Rincian kas seharusnya"
        >
          <div className="flex justify-between">
            <span className="text-zinc-500">Modal awal</span>
            <span className="font-mono tabular-nums">
              {formatRupiah(result.opening_cash)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Penjualan tunai</span>
            <span className="font-mono tabular-nums">
              {formatRupiah(result.cash_sales)}
            </span>
          </div>
          {result.cash_refunds > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Refund tunai (retur)</span>
              <span className="font-mono tabular-nums">
                − {formatRupiah(result.cash_refunds)}
              </span>
            </div>
          )}
          {result.cash_in > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Kas masuk</span>
              <span className="font-mono tabular-nums">
                + {formatRupiah(result.cash_in)}
              </span>
            </div>
          )}
          {result.cash_out > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Kas keluar</span>
              <span className="font-mono tabular-nums">
                − {formatRupiah(result.cash_out)}
              </span>
            </div>
          )}
          {result.cash_voided > 0 && (
            <p className="pt-1 text-zinc-400">
              Penjualan tunai {formatRupiah(result.cash_voided)} yang di-void
              tidak dihitung.
            </p>
          )}
        </div>

        <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Kas seharusnya</span>
            <span className="font-mono tabular-nums">
              {formatRupiah(result.expected_cash)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Kas fisik</span>
            <span className="font-mono tabular-nums">
              {formatRupiah(result.actual_cash)}
            </span>
          </div>
          <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-2">
            <span className="text-zinc-500">Selisih</span>
            <span
              className={`font-mono tabular-nums font-semibold ${differenceColorClass(result.difference)}`}
            >
              {differenceLabel(result.difference)}
            </span>
          </div>
        </div>
        {result.notes && (
          <div className="mt-3 rounded-md border border-zinc-200 dark:border-zinc-800 p-3 text-xs">
            <p className="mb-1 text-zinc-500">Catatan penutupan</p>
            <p className="whitespace-pre-wrap break-words">{result.notes}</p>
          </div>
        )}
        <button
          type="button"
          onClick={onDone}
          className="mt-5 w-full rounded-md bg-lco-green px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
        >
          Selesai
        </button>
      </div>
    </div>
  );
}
