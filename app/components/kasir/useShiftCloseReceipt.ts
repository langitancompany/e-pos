"use client";

// app/components/kasir/useShiftCloseReceipt.ts
// ── TAMBAHAN (struk Tutup Sesi Kas) ── Menyusun & mencetak struk Tutup Sesi
// setelah close_shift sukses. Dipakai di layar Kasir (useKasirShiftSession)
// dan menu Sesi Kasir & Kas (KasModule) supaya struknya sama persis.
// Kegagalan printer tidak boleh membatalkan penutupan sesi: pemanggil tidak
// menunggu hasil cetak.

import { useCallback } from "react";
import type { CloseShiftResult } from "@/hooks/useShifts";
import { buildShiftCloseReceipt } from "@/lib/pos/kasirLogic";
import { getReceiptBranding } from "./kasirReceiptBranding";
import type {
  KasirUser,
  OutletSettingsValue,
  PosSettings,
  PrintReceiptFn,
} from "./kasirHookTypes";

interface Params {
  posSettings: PosSettings;
  outlet: OutletSettingsValue;
  user: KasirUser;
  printReceipt: PrintReceiptFn;
}

export function useShiftCloseReceipt({
  posSettings,
  outlet,
  user,
  printReceipt,
}: Params) {
  return useCallback(
    (result: CloseShiftResult, openedAt: string | null) => {
      const receipt = buildShiftCloseReceipt({
        branding: getReceiptBranding(posSettings, outlet, {
          withPromo: false,
        }),
        now: new Date(),
        cashierName: user?.full_name ?? user?.email ?? null,
        openedAt,
        result,
      });
      void printReceipt(receipt);
    },
    [posSettings, outlet, user, printReceipt],
  );
}
