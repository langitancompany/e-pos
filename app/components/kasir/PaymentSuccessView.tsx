"use client";

// app/components/kasir/PaymentSuccessView.tsx
// ── Dipecah dari PaymentModal.tsx — layar "Pembayaran Berhasil" (toast, preview struk, Kirim WA, Selesai).
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import { CheckCircle2, Loader2, MessageCircle, ArrowRight } from "lucide-react";
import type { ReceiptData } from "@/lib/pos/printLogic";
import Button from "@/app/components/ui/Button";
import Modal from "@/app/components/ui/Modal";
import Toast from "@/app/components/ui/Toast";
import ReceiptPreview from "./ReceiptPreview";

export default function PaymentSuccessView({
  receipt,
  printToastVisible,
  printToastDurationMs,
  canSendWhatsApp,
  waStatus,
  waMethod,
  waError,
  onSendWhatsApp,
  onFinish,
}: {
  receipt?: ReceiptData | null;
  printToastVisible: boolean;
  printToastDurationMs: number;
  /** Tombol Kirim WA hanya tampil kalau parent menyediakan handler-nya. */
  canSendWhatsApp: boolean;
  waStatus: "idle" | "sending" | "sent" | "error";
  waMethod: "web-share" | "download-fallback" | null;
  waError: string | null;
  onSendWhatsApp: () => void;
  onFinish: () => void;
}) {
  return (
    <>
      {/* ── PERBAIKAN (auto-print setelah bayar) ── Toast dirender sebagai
            saudara (bukan anak) dari overlay modal di bawah, supaya posisinya
            benar-benar "tengah-atas LAYAR" (fixed viewport), bukan cuma
            tengah-atas kartu modal. */}
      <Toast
        visible={printToastVisible}
        message="Struk berhasil dicetak"
        variant="success"
        durationMs={printToastDurationMs}
      />
      <Modal
        size="sm"
        padding="none"
        layout="flex"
        aria-label="Pembayaran berhasil"
      >
        {/* ── Satu kartu menyatu: konfirmasi sukses di atas, preview struk
            (selalu putih, seperti kertas struk asli — tidak ikut dark mode)
            di tengah, lalu tombol aksi di bawah. ── */}
        <div className="p-6 pb-4 flex flex-col items-center text-center shrink-0">
          <CheckCircle2 className="w-14 h-14 text-lco-green mb-3" />
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-1">
            Pembayaran Berhasil!
          </h2>
          <p className="text-zinc-500 text-xs">
            {receipt
              ? "Struk otomatis tercetak. Kirim ke pelanggan atau lanjut ke transaksi berikutnya."
              : "Kirim struk digital ke pelanggan atau lanjut ke transaksi berikutnya."}
          </p>
        </div>

        {/* ── Preview struk/nota — dipaksa bg putih & teks gelap (bg-white
            text-zinc-800, TANPA varian dark:) apa pun tema aplikasinya,
            supaya tampak seperti kertas struk sungguhan, bukan kartu UI. ── */}
        {receipt && <ReceiptPreview receipt={receipt} />}

        {/* ── Aksi: Kirim WA / Selesai (cetak sudah otomatis, lihat efek
            isSuccess di atas — tinggal 2 tombol sesuai permintaan). ── */}
        <div className="px-6 pb-6 pt-1 flex flex-col shrink-0">
          {canSendWhatsApp && (
            <div className="w-full mb-3">
              <Button
                type="button"
                onClick={onSendWhatsApp}
                disabled={waStatus === "sending" || waStatus === "sent"}
                variant="secondary"
                size="lg"
                fullWidth
              >
                {waStatus === "sending" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Menyiapkan
                    Gambar Struk...
                  </>
                ) : waStatus === "sent" ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    {waMethod === "web-share"
                      ? "Terkirim ke Sheet Share"
                      : "Gambar Terunduh, WhatsApp Terbuka"}
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" /> Kirim Struk via
                    WhatsApp
                  </>
                )}
              </Button>
              {waStatus === "sent" && waMethod === "download-fallback" && (
                <p className="mt-2 text-[11px] text-zinc-500 text-left">
                  Lampirkan gambar struk yang baru terunduh ke chat WhatsApp
                  secara manual.
                </p>
              )}
              {waStatus === "error" && waError && (
                <p className="mt-2 text-[11px] text-lco-coral text-left">
                  {waError}
                </p>
              )}
            </div>
          )}

          <Button type="button" onClick={onFinish} size="lg" fullWidth>
            Selesai <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </Modal>
    </>
  );
}
