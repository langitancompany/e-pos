"use client";

// app/components/kasir/useKasirLayoutMode.ts
// ── Dipecah dari KasirModule.tsx. Isi dipindah apa adanya.
//
// Pilihan layout kasir ("tablet" | "pc") diingat per-DEVICE (bukan per-akun —
// kasir yang sama bisa pindah dari komputer ber-mouse+keyboard ke tablet kapan
// saja). Default "tablet" supaya perilaku existing tidak berubah. localStorage
// cuma dibaca SETELAH mount (bukan di initializer useState) supaya render
// server & client pertama identik (hindari hydration mismatch Next.js).

import { useEffect, useState } from "react";

const LAYOUT_MODE_STORAGE_KEY = "lco-pos:kasir-layout-mode";

export type KasirLayoutMode = "tablet" | "pc";

export function useKasirLayoutMode() {
  const [layoutMode, setLayoutMode] = useState<KasirLayoutMode>("tablet");

  useEffect(() => {
    const saved = window.localStorage.getItem(LAYOUT_MODE_STORAGE_KEY);
    if (saved === "pc" || saved === "tablet") setLayoutMode(saved);
  }, []);

  const toggleLayoutMode = () => {
    setLayoutMode((prev) => {
      const next: KasirLayoutMode = prev === "pc" ? "tablet" : "pc";
      window.localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, next);
      return next;
    });
  };

  return { layoutMode, toggleLayoutMode };
}
