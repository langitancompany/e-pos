"use client";

import { CheckCircle2, XCircle } from "lucide-react";

export type ToastVariant = "success" | "error";

type ToastProps = {
  /** Kalau false, komponen tidak me-render apa pun (bukan cuma disembunyikan lewat CSS). */
  visible: boolean;
  message: string;
  variant?: ToastVariant;
  /**
   * Lama notifikasi tampil sebelum hilang otomatis, dalam ms, dipakai untuk
   * mengatur durasi animasi garis countdown supaya PERSIS selesai bersamaan
   * dengan waktu pemanggil menyembunyikan toast ini (lihat `printToastTimeoutRef`
   * di PaymentModal.tsx). Default 3000ms.
   */
  durationMs?: number;
};

/**
 * Notifikasi pop-up di kanan bawah layar dengan garis countdown yang
 * menyusut sampai notifikasi hilang. Komponen ini hanya urusan tampilan:
 * kapan `visible` jadi true/false diatur pemanggil (biasanya lewat
 * `setTimeout`), supaya pemanggil tetap bisa membatalkan atau memperpanjang
 * timer-nya sendiri.
 *
 * Komponen return `null` saat `visible` false, jadi tiap kali `visible` jadi
 * true React membuat node DOM baru dan animasi masuk serta garis countdown
 * mulai dari awal tanpa perlu `key` dari pemanggil.
 */
export default function Toast({
  visible,
  message,
  variant = "success",
  durationMs = 3000,
}: ToastProps) {
  if (!visible) return null;

  const isSuccess = variant === "success";

  // Wrapper luar menempel di pojok kanan bawah dan menyisakan ruang untuk
  // safe area (HP dengan notch/home bar). Animasi hanya menggeser sumbu Y di
  // elemen dalam, tanpa class translate Tailwind, supaya tidak bertumpuk.
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-[70] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-[calc(100vw-2rem)] max-w-sm animate-toast-in"
      >
        <div
          className={`overflow-hidden rounded-lg border shadow-lg backdrop-blur-sm ${
            isSuccess
              ? "bg-white/95 dark:bg-zinc-900/95 border-lco-green/30"
              : "bg-white/95 dark:bg-zinc-900/95 border-lco-coral/30"
          }`}
        >
          <div className="flex items-center gap-2.5 px-4 py-3">
            {isSuccess ? (
              <CheckCircle2 className="w-4.5 h-4.5 shrink-0 text-lco-green" />
            ) : (
              <XCircle className="w-4.5 h-4.5 shrink-0 text-lco-coral" />
            )}
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {message}
            </p>
          </div>
          {/* Lebar 100% ke 0% selama durationMs; pemanggil menyembunyikan toast
              tepat saat animasi ini selesai. */}
          <div className="h-0.5 w-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={`h-full ${isSuccess ? "bg-lco-green" : "bg-lco-coral"} animate-toast-countdown`}
              style={{ animationDuration: `${durationMs}ms` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
