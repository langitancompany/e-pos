"use client";

// app/components/kasir/useKasirShortcuts.ts
// ── Dipecah dari KasirModule.tsx. Shortcut keyboard mode PC. HANYA aktif saat
// `enabled` (mode PC & shift terbuka); di mode Tablet / layar terkunci tombol
// F1-F8 dibiarkan berperilaku normal browser. F-key dipakai sebagai jalur
// utama karena tidak pernah dipakai browser untuk mengetik teks — kecuali F5
// (refresh) yang sengaja di-preventDefault karena "Bersihkan" versi kasir
// bukan reload halaman. Ctrl/Cmd+K/U/D/Enter dan Alt+7 sebagai alias.
//
// Handler dibaca lewat ref supaya selalu versi terbaru tanpa memasang ulang
// listener tiap render (versi lama bergantung pada deps manual
// [layoutMode, activeShift, cart, isSavingTransaction]).

import { useEffect, useRef } from "react";

export interface KasirShortcutHandlers {
  onFocusCode: () => void; // F1 / Ctrl+K
  onFocusCustomer: () => void; // F2 / Ctrl+U
  onHold: () => void; // F3
  onClearCart: () => void; // F5 (sudah termasuk konfirmasi)
  onFocusDiscount: () => void; // F6 / Ctrl+D
  onOpenBiayaTambahan: () => void; // F7 / Alt+7
  onPay: () => void; // F8 / Ctrl+Enter
}

export function useKasirShortcuts(
  enabled: boolean,
  handlers: KasirShortcutHandlers,
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "F1" || (mod && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        h.onFocusCode();
      } else if (e.key === "F2" || (mod && e.key.toLowerCase() === "u")) {
        e.preventDefault();
        h.onFocusCustomer();
      } else if (e.key === "F3") {
        e.preventDefault();
        h.onHold();
      } else if (e.key === "F5") {
        e.preventDefault();
        h.onClearCart();
      } else if (e.key === "F6" || (mod && e.key.toLowerCase() === "d")) {
        e.preventDefault();
        h.onFocusDiscount();
      } else if (e.key === "F7" || (e.altKey && e.key === "7")) {
        e.preventDefault();
        h.onOpenBiayaTambahan();
      } else if (e.key === "F8" || (mod && e.key === "Enter")) {
        e.preventDefault();
        h.onPay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
