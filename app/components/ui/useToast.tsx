"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Toast, { type ToastVariant } from "./Toast";

export const DEFAULT_TOAST_MS = 3000;

type ToastState = { id: number; message: string; variant: ToastVariant };

type UseToastResult = {
  /** Tampilkan toast. Panggilan baru menggantikan toast yang masih tampil. */
  notify: (message: string, variant?: ToastVariant) => void;
  /** Sembunyikan toast sekarang juga. */
  dismiss: () => void;
  /** Taruh sekali di JSX modul pemanggil. */
  toastElement: ReactNode;
};

/**
 * Hook untuk Toast.tsx: mengurus state, timer auto-hide, dan pembersihan saat
 * unmount, supaya modul cukup memanggil `notify(...)` dan merender
 * `toastElement` sekali. Durasi countdown di Toast dan timer penyembunyi
 * memakai nilai `durationMs` yang sama, jadi selesai bersamaan.
 */
export function useToast(durationMs: number = DEFAULT_TOAST_MS): UseToastResult {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const notify = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      clearTimer();
      idRef.current += 1;
      setToast({ id: idRef.current, message, variant });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, durationMs);
    },
    [clearTimer, durationMs],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const toastElement = (
    <Toast
      key={toast?.id ?? 0}
      visible={toast !== null}
      message={toast?.message ?? ""}
      variant={toast?.variant ?? "success"}
      durationMs={durationMs}
    />
  );

  return { notify, dismiss, toastElement };
}
