"use client";

// app/components/promo/ScreenQrCode.tsx
// ── Dipecah dari PromoModule.tsx (lihat catatan di file itu). Isi dipindah
// apa adanya, tanpa perubahan logika.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Loader2,
} from "lucide-react";

// ── Kode QR ─────────────────────────────────────────────────────────────

/**
 * Kode QR dibuat di browser (client-side, `QRCode.toDataURL`) — tidak
 * pernah mengirim `url` (yang mengandung access_token) ke layanan pihak
 * ketiga manapun, beda dari pola "tempel ke API QR publik" yang umum
 * dipakai tapi bocor token ke pihak luar.
 */
export default function ScreenQrCode({ url, size = 96 }: { url: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    QRCode.toDataURL(url, { width: size, margin: 1 })
      .then((result) => {
        if (!cancelled) setDataUrl(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-300 text-center text-[10px] text-zinc-400 dark:border-zinc-700"
      >
        Gagal buat QR
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800"
      >
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URL lokal (base64) dibuat di browser, bukan aset untuk dioptimasi next/image
    <img
      src={dataUrl}
      alt="Kode QR alamat TV ini"
      width={size}
      height={size}
      className="shrink-0 rounded-md border border-zinc-200 dark:border-zinc-800"
    />
  );
}
