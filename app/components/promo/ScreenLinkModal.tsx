"use client";

// app/components/promo/ScreenLinkModal.tsx
// ── Dipecah dari PromoModule.tsx (lihat catatan di file itu). Isi dipindah
// apa adanya, tanpa perubahan logika.

import { useState } from "react";
import {
  Check,
  Copy,
  X,
} from "lucide-react";
import {
  buildScreenUrl,
  type PromoScreen,
} from "@/hooks/usePromoScreens";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import ScreenQrCode from "./ScreenQrCode";

/** Modal QR besar + link lengkap + tombol salin, dibuka dari daftar TV. */
export default function ScreenLinkModal({
  screen,
  onClose,
}: {
  screen: PromoScreen;
  onClose: () => void;
}) {
  const url = buildScreenUrl(screen.access_token);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API bisa ditolak (browser lama / bukan HTTPS) — diamkan,
      // link teksnya masih bisa disalin manual lewat seleksi biasa.
    }
  }

  return (
    <Modal
      size="sm"
      padding="md"
      layout="plain"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-semibold">
          Akses TV — {screen.name}
        </h3>
        <IconButton
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          variant="soft"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="flex justify-center">
        <ScreenQrCode url={url} size={220} />
      </div>

      <p className="mt-4 break-all rounded-md border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        {url}
      </p>

      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Pindai kode QR dari Android box/tablet TV, atau salin link ini dan
        buka langsung di browser TV lalu layar penuh. Alamat ini bisa dibuka
        siapa pun tanpa login — jangan sebarkan ke luar kalau TV menampilkan
        materi internal.
      </p>

      <Button
        type="button"
        onClick={() => void handleCopy()}
        variant="secondary"
        fullWidth
        className="mt-4"
      >
        {copied ? (
          <Check className="h-4 w-4 text-lco-green" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copied ? "Tersalin!" : "Salin Link"}
      </Button>
    </Modal>
  );
}
