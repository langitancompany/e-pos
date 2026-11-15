// app/components/misc/InstallPrompt.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Plus, Share, X } from "lucide-react";

// Event ini belum ada di tipe TypeScript bawaan.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "lco_pos_pwa_install_dismissed_at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // tanya lagi setelah 7 hari
const SHOW_DELAY_MS = 3000; // jangan langsung muncul saat halaman baru dibuka

// Layar untuk pelanggan / perangkat tanpa kasir tidak perlu ajakan install.
const EXCLUDED_PREFIXES: string[] = [
  "/tv",
  "/kasir-display",
  "/cek-struk",
  "/auth",
  "/set-password",
];

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    // iOS Safari
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Petunjuk manual untuk browser yang tidak punya prompt install otomatis.
type ManualMode = "ios-safari" | "ios-other" | "mac-safari";

function isIOS(): boolean {
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

// Versi iOS dari user agent (iPadOS mode desktop tidak menyertakannya → null).
function iosVersion(): [number, number] | null {
  const m = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function detectManualMode(): ManualMode | null {
  const ua = navigator.userAgent;

  if (isIOS()) {
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
    if (isSafari) return "ios-safari";

    // Chrome & Edge di iOS: bisa sejak iOS/iPadOS 16.4.
    if (/CriOS|EdgiOS/.test(ua)) {
      const v = iosVersion();
      if (!v || v[0] > 16 || (v[0] === 16 && v[1] >= 4)) return "ios-other";
    }
    return null; // Firefox/Opera/dll di iOS: tidak ditangani
  }

  // Safari di Mac (Safari 17 ke atas): File → Add to Dock.
  const isMac = /Macintosh/.test(ua) && navigator.maxTouchPoints === 0;
  const isSafariMac =
    isMac && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|FxiOS/.test(ua);
  if (isSafariMac) {
    const m = ua.match(/Version\/(\d+)/);
    if (m && Number(m[1]) >= 17) return "mac-safari";
  }
  return null;
}

function recentlyDismissed(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return t > 0 && Date.now() - t < COOLDOWN_MS;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [manualMode, setManualMode] = useState<ManualMode | null>(null);

  const excluded = EXCLUDED_PREFIXES.some((p) => pathname?.startsWith(p));

  useEffect(() => {
    if (excluded) return;
    if (isStandalone()) return; // sudah terpasang & dibuka sebagai aplikasi

    // Mendaftarkan file yang sama berulang kali aman. Dibutuhkan agar
    // aplikasi bisa dipasang di browser yang masih mensyaratkan service worker.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleShow = () => {
      if (recentlyDismissed()) return;
      timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    // Chrome / Edge / Samsung Internet / Opera (Android & desktop).
    // Event ini HANYA terpicu kalau aplikasi belum terpasang, jadi otomatis
    // "hanya jika belum di-download".
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // tahan mini-infobar bawaan, kita tampilkan UI sendiri
      setDeferred(e as BeforeInstallPromptEvent);
      scheduleShow();
    };

    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS & Safari Mac: tidak ada event install, hanya bisa memberi petunjuk.
    const manual = detectManualMode();
    if (manual) {
      setManualMode(manual);
      scheduleShow();
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, [excluded]);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    // prompt() wajib dipanggil dari klik pengguna.
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null); // event hanya bisa dipakai sekali
    if (outcome === "accepted") setVisible(false);
    else dismiss();
  };

  if (excluded || !visible || (!deferred && !manualMode)) return null;

  return (
    // Di ponsel tampil di ATAS supaya tidak menutup tombol bayar di bawah layar kasir.
    <div
      role="dialog"
      aria-label="Pasang aplikasi"
      className="fixed inset-x-0 top-0 z-[80] p-3 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:max-w-sm sm:p-0"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Pasang LCO POS di perangkat ini
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Buka langsung dari layar utama, tampil layar penuh tanpa bilah
              alamat browser.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Tutup"
            className="-mr-1 -mt-1 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {deferred ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={install}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-lco-green px-4 py-2 text-sm font-medium text-white hover:bg-lco-green-hover"
            >
              <Download className="h-4 w-4" />
              Pasang
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-xl px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Nanti
            </button>
          </div>
        ) : (
          <ol className="mt-3 space-y-2 text-xs text-zinc-700 dark:text-zinc-300">
            {manualMode === "mac-safari" ? (
              <li className="flex items-center gap-2">
                <Plus className="h-4 w-4 shrink-0" />
                <span>
                  Di menu Safari pilih <b>File → Add to Dock…</b>, lalu klik{" "}
                  <b>Add</b>
                </span>
              </li>
            ) : (
              <>
                <li className="flex items-center gap-2">
                  <Share className="h-4 w-4 shrink-0" />
                  <span>
                    {manualMode === "ios-other" ? (
                      <>
                        Ketuk ikon <b>Bagikan</b> (kotak dengan panah ke atas)
                        di bilah alamat atau menu browser
                      </>
                    ) : (
                      <>
                        Ketuk tombol <b>Bagikan</b> di Safari
                      </>
                    )}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>
                    Pilih <b>Tambah ke Layar Utama</b>, lalu <b>Tambah</b>
                  </span>
                </li>
              </>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
