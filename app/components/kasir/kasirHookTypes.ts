// app/components/kasir/kasirHookTypes.ts
// ── Dipecah dari KasirModule.tsx. Tipe bersama untuk hook-hook layar Kasir.
// Diturunkan dari hook sumbernya (ReturnType) supaya tidak menyalin definisi
// dan otomatis ikut berubah kalau hook aslinya berubah.

import type { useSettings } from "@/hooks/useSettings";
import type { useAuth } from "@/hooks/useAuth";
import type { usePrinterProfiles } from "@/hooks/usePrinterProfiles";

export type PosSettings = ReturnType<typeof useSettings>["settings"];
export type OutletSettingsValue = ReturnType<typeof useSettings>["outlet"];
export type KasirUser = ReturnType<typeof useAuth>["user"];
export type PrintReceiptFn = ReturnType<
  typeof usePrinterProfiles
>["printReceipt"];
