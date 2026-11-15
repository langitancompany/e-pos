// app/components/hadiah/hadiahExport.ts
// ── TAMBAHAN (migration 044) ── Ekspor Excel rekap Hadiah & Oleh-oleh untuk
// pembukuan. Dibangun dari DATA MENTAH: kolom jumlah & rupiah ditulis sebagai
// ANGKA asli supaya bisa dijumlah/difilter/di-pivot di Excel. Diproses di
// browser (pola yang sama dengan app/components/stok/stokExport.ts).
//
// ASYNC: `exportGiftsToExcel` mengembalikan Promise (lihat lib/pos/xlsxWriter.ts).
//
// Hadiah berstatus "Dibatalkan" tetap ditampilkan (untuk jejak audit) tapi
// TIDAK dihitung di total beban.

import { downloadXlsx, type XlsxSheet } from "@/lib/pos/xlsxWriter";
import {
  GIFT_CATEGORY_LABEL,
  type GiftRecord,
} from "@/hooks/useGifts";

type Cell = string | number | null;

function buildFileBaseName(prefix: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${prefix}_${year}-${month}-${day}`;
}

function formatDateOnlyForSheet(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

export async function exportGiftsToExcel(
  gifts: GiftRecord[],
  periodLabel: string,
): Promise<void> {
  const active = gifts.filter((gift) => gift.status === "completed");

  const totalCost = active.reduce((sum, gift) => sum + gift.total_cost, 0);
  const totalRetail = active.reduce((sum, gift) => sum + gift.total_retail, 0);
  const totalQty = active.reduce((sum, gift) => sum + gift.total_qty, 0);

  // ---- Sheet 1: Ringkasan ----
  const summaryRows: Cell[][] = [
    ["Rekap Hadiah & Oleh-oleh"],
    ["Periode", periodLabel],
    [],
    ["Jumlah pemberian", active.length],
    ["Total unit", totalQty],
    ["Total beban hadiah (harga modal)", totalCost],
    ["Nilai jika dijual (info)", totalRetail],
    [],
    ["Per kategori penerima", "Pemberian", "Unit", "Beban (Modal)"],
  ];

  for (const [key, label] of Object.entries(GIFT_CATEGORY_LABEL)) {
    const rows = active.filter((gift) => gift.recipient_category === key);
    summaryRows.push([
      label,
      rows.length,
      rows.reduce((sum, gift) => sum + gift.total_qty, 0),
      rows.reduce((sum, gift) => sum + gift.total_cost, 0),
    ]);
  }

  // ---- Sheet 2: Daftar hadiah ----
  const header: Cell[] = [
    "No. Hadiah",
    "Tanggal",
    "Penerima",
    "Kategori",
    "Keperluan",
    "Catatan",
    "Jumlah Produk",
    "Total Unit",
    "Beban (Modal)",
    "Nilai Jika Dijual",
    "Status",
    "Dicatat Oleh",
  ];

  const listRows: Cell[][] = [header];

  for (const gift of gifts) {
    listRows.push([
      gift.number,
      formatDateOnlyForSheet(gift.given_at),
      gift.recipient_name,
      GIFT_CATEGORY_LABEL[gift.recipient_category],
      gift.occasion,
      gift.note,
      gift.item_count,
      gift.total_qty,
      gift.total_cost,
      gift.total_retail,
      gift.status === "voided" ? "Dibatalkan" : "Selesai",
      gift.created_by_name,
    ]);
  }

  const sheets: XlsxSheet[] = [
    {
      name: "Ringkasan",
      rows: summaryRows,
      colWidths: [36, 18, 12, 18],
    },
    {
      name: "Daftar Hadiah",
      rows: listRows,
      colWidths: [11, 14, 26, 22, 28, 28, 14, 11, 16, 18, 12, 20],
    },
  ];

  await downloadXlsx(sheets, `${buildFileBaseName("hadiah-oleh-oleh")}.xlsx`);
}
