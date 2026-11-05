"use client";

// app/components/kasir/ReceiptPreview.tsx
// ── Dipecah dari PaymentModal.tsx — preview struk di layar sukses pembayaran.
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import type { ReceiptData } from "@/lib/pos/printLogic";
import { formatMethodLabel, formatRp } from "./paymentUtils";

export default function ReceiptPreview({ receipt }: { receipt: ReceiptData }) {
  return (
    <div className="mx-6 mb-4 rounded-lg border border-zinc-200 bg-white overflow-hidden shrink-0">
      <div className="px-4 py-2 border-b border-dashed border-zinc-300 bg-zinc-50">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 text-center">
          Preview Struk
        </p>
      </div>
      <div className="max-h-[38vh] overflow-y-auto px-4 py-3">
        <div className="font-mono text-[11px] leading-relaxed text-zinc-800">
          {/* ── KOREKSI (bug: preview tidak sama dengan hasil cetak) ──
                    Sebelumnya preview langsung mulai dari No. Struk, tanpa
                    pernah menampilkan nama toko/alamat/telepon (dari
                    Pengaturan > Toko) ataupun tanggal & metode pembayaran —
                    padahal semua itu ADA di template HTML yang benar-benar
                    dicetak (lihat printThermalReceipt() di printLogic.ts).
                    Blok di bawah ini disusun mengikuti urutan yang sama
                    persis dengan template cetak: nama toko -> alamat ->
                    telepon -> No. Struk/Waktu/Kasir/Pelanggan/Metode ->
                    item -> total -> footer. ── */}
          <p className="text-center font-bold text-sm mb-0.5 text-zinc-900">
            {receipt.storeName || "Langitan.co"}
          </p>
          {receipt.storeAddress && (
            <p className="text-center text-zinc-600">{receipt.storeAddress}</p>
          )}
          {receipt.storePhone && (
            <p className="text-center text-zinc-600 mb-1">
              {receipt.storePhone}
            </p>
          )}

          <div className="border-t border-dashed border-zinc-300 my-2" />

          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>No. Struk</span>
              <span>{receipt.receiptNo}</span>
            </div>
            <div className="flex justify-between">
              <span>Waktu</span>
              <span>
                {receipt.createdAt
                  ? new Date(receipt.createdAt).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "-"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Kasir</span>
              <span>{receipt.cashierName ?? "-"}</span>
            </div>
            {receipt.customerName && (
              <div className="flex justify-between">
                <span>Pelanggan</span>
                <span>{receipt.customerName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Metode</span>
              <span>{formatMethodLabel(receipt.method)}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-zinc-300 my-2" />

          <div className="space-y-1.5">
            {(receipt.items ?? []).map((item, idx) => (
              <div key={idx}>
                <p className="truncate text-zinc-800">{item.name}</p>
                <div className="flex justify-between text-zinc-500">
                  <span>
                    {item.qty} x {formatRp(item.price)}
                  </span>
                  <span className="tabular-nums">
                    {formatRp(item.price * item.qty)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-zinc-300 my-2" />

          {/* ── CATATAN: beberapa field ReceiptData (discount, tax, dll)
                    opsional di tipe aslinya, jadi dipakai dengan fallback
                    `?? 0` di sini supaya aman dari undefined, baik untuk
                    TypeScript maupun tampilan (bukan cuma kosmetik). */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">
                {formatRp(receipt.subtotal ?? 0)}
              </span>
            </div>
            {(receipt.discount ?? 0) > 0 && (
              <div className="flex justify-between">
                <span>Diskon</span>
                <span className="tabular-nums">
                  -{formatRp(receipt.discount ?? 0)}
                </span>
              </div>
            )}
            {(receipt.tax ?? 0) > 0 && (
              <div className="flex justify-between">
                <span>Pajak</span>
                <span className="tabular-nums">
                  {formatRp(receipt.tax ?? 0)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-sm text-zinc-900 pt-1">
              <span>Total</span>
              <span className="tabular-nums">
                {formatRp(receipt.total ?? 0)}
              </span>
            </div>
          </div>

          <div className="border-t border-dashed border-zinc-300 my-2" />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Bayar</span>
              <span className="tabular-nums">
                {formatRp(receipt.paidAmount ?? 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Kembali</span>
              <span className="tabular-nums">
                {formatRp(receipt.changeAmount ?? 0)}
              </span>
            </div>
          </div>

          {/* ── TAMBAHAN (bug: preview tidak sama dengan hasil cetak) ──
                    Footer struk (Pengaturan > Toko > footerStruk) dulu tidak
                    pernah ditampilkan di preview, padahal selalu ada di
                    bagian bawah struk fisik. ── */}
          <div className="border-t border-dashed border-zinc-300 my-2" />
          <p className="text-center text-zinc-600">
            {receipt.footerText || "Terima kasih atas kunjungan Anda"}
          </p>
        </div>
      </div>
    </div>
  );
}
