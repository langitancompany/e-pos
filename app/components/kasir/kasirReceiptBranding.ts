// app/components/kasir/kasirReceiptBranding.ts
// ── Dipecah dari KasirModule.tsx. Field identitas toko di struk (nama, alamat,
// telepon, footer, header outlet, + QR promo) dari Pengaturan > Toko, dipakai
// bersama struk penjualan & struk Buka Kasir. Disamakan dengan pengisian di
// TransactionDetailModal (cetak ulang). Tanpa ini printLogic.ts jatuh ke
// fallback hardcode ("Langitan.co", tanpa alamat/telepon).

import type { ReceiptData } from "@/lib/pos/printLogic";
import { getReceiptPromo } from "@/lib/pos/receiptQr";
import type { OutletSettingsValue, PosSettings } from "./kasirHookTypes";

export function getReceiptBranding(
  posSettings: PosSettings,
  outlet: OutletSettingsValue,
  options: { withPromo: boolean },
): Partial<ReceiptData> {
  return {
    storeName: posSettings.namaToko,
    storeAddress: posSettings.alamat,
    storePhone: posSettings.telepon,
    footerText: posSettings.footerStruk,
    headerText: outlet.headerStruk || undefined,
    // Struk Buka Kasir (layout shift_open) memang tidak membawa QR promo.
    ...(options.withPromo ? getReceiptPromo(posSettings) : {}),
  };
}
