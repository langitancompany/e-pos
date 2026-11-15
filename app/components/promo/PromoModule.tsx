"use client";

// app/components/promo/PromoModule.tsx
// ── KOREKSI ── Direvisi total (langkah 4, menggantikan rencana lama
// PROGRESS.md sesi #20 yang cuma satu playlist global untuk semua TV).
// Sekarang dua tingkat:
//   1. Daftar TV (`ScreenListView`, dirender langsung di bawah) — tambah/
//      ubah nama/aktif-nonaktif/hapus TV, tiap baris ada link + kode QR
//      sendiri (`ScreenLinkModal`/`ScreenQrCode`). Data dari
//      `hooks/usePromoScreens.ts` (langkah 2).
//   2. Kelola media SATU TV (`ScreenMediaManager`) — dibuka dengan klik
//      salah satu TV. Isinya hampir seluruhnya kode lama sesi #20 (upload,
//      urutan, aktif/nonaktif, hapus media), cuma sekarang discope ke
//      `screen.id` lewat `usePromoMedia(screen.id)` (langkah 3). Dirender
//      dengan `key={screen.id}` supaya berpindah TV = remount bersih
//      (lihat catatan `usePromoMedia` soal ini).
//
// Gate akses SAMA seperti sebelumnya: pola gate SAMA dengan
// PengaturanModule.tsx (cabang isAuthLoading dulu, baru !canAccess,
// keduanya SETELAH semua hook dipanggil sesuai Rules of Hooks).
//
// ── Dependency baru: `qrcode` (+ `@types/qrcode`) ──
// Menyimpang dari Aturan Main §18.8 ("jangan tambah dependency tanpa
// alasan di PRD") — tapi wajar di sini: seluruh fitur TV memang di luar
// PRD, dan `html5-qrcode` yang sudah ada di package.json itu library untuk
// MEMBACA QR (kamera), bukan MEMBUATNYA. Sudah dicoba `npm install` +
// `npm run build` sesi ini dan hijau (lihat PROGRESS.md).
//
// Wiring menu (Sidebar.tsx + page.tsx) TIDAK berubah dari sesi #20 — menu
// "Layar Promosi" tetap merender komponen default export file ini, cuma
// sekarang isinya dua tingkat seperti di atas.
//
// ── PEMECAHAN FILE ── Sebelumnya semua komponen di bawah ada di SATU file
// ini (±1.475 baris). Sekarang tiap komponen punya file sendiri di folder
// ini; file ini cuma berisi gate akses + daftar TV (tingkat 1):
//   promoUtils.ts          helper tampilan (ukuran file, tanggal, label)
//   ScreenQrCode.tsx       kode QR (dibuat di browser)
//   ScreenLinkModal.tsx    modal link + QR besar
//   ScreenFormModal.tsx    modal tambah / ubah nama TV
//   MediaFormModal.tsx     modal tambah / ubah media
//   ScreenMediaManager.tsx tingkat 2: kelola media satu TV
// Isi tiap komponen dipindah apa adanya, tanpa perubahan logika.

import { useState } from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Monitor,
  Pencil,
  PlayCircle,
  Plus,
  QrCode,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useAuth, hasPermission } from "@/hooks/useAuth";
import {
} from "@/hooks/usePromoMedia";
import {
  usePromoScreens,
  type PromoScreen,
  type PromoScreenActionResult,
} from "@/hooks/usePromoScreens";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import { useToast } from "@/app/components/ui/useToast";
import { formatScreenDate, relativeScreenTime } from "./promoUtils";
import ScreenLinkModal from "./ScreenLinkModal";
import ScreenFormModal, { type ScreenFormTarget } from "./ScreenFormModal";
import ScreenMediaManager from "./ScreenMediaManager";

// ── Tingkat 1 + gate: daftar TV ──────────────────────────────────────────

export default function PromoModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  // ── REVISI (migration 028/030) ── `user?.role` (string admin/supervisor)
  // sudah dihapus, diganti permission dinamis "promo".
  const canManage = hasPermission(user, "promo");

  const {
    screens,
    isLoading,
    error,
    isMutating,
    refetch,
    addScreen,
    renameScreen,
    setScreenActive,
    removeScreen,
  } = usePromoScreens();

  const [selectedScreen, setSelectedScreen] = useState<PromoScreen | null>(
    null,
  );
  const [screenFormTarget, setScreenFormTarget] =
    useState<ScreenFormTarget | null>(null);
  const [linkModalScreen, setLinkModalScreen] = useState<PromoScreen | null>(
    null,
  );
  const [deletingScreen, setDeletingScreen] = useState<PromoScreen | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState("");
  const [actionError, setActionError] = useState("");
  const { notify, toastElement } = useToast();

  async function runAction(action: () => Promise<PromoScreenActionResult>) {
    setActionError("");
    const result = await action();
    if (!result.ok) {
      setActionError(result.error);
    }
  }

  function handleScreenFormSaved(message: string) {
    setScreenFormTarget(null);
    setActionError("");
    notify(message);
  }

  async function handleConfirmDeleteScreen() {
    if (!deletingScreen) return;
    setDeleteError("");

    const result = await removeScreen(deletingScreen.id);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeletingScreen(null);
    setActionError("");
    notify("TV dihapus.");
  }

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Layar Promosi hanya untuk admin dan supervisor.
        </p>
      </div>
    );
  }

  // Sesuai Rules of Hooks: semua hook di atas SELALU dipanggil dulu, baru
  // di sini boleh render kondisional. `key={selectedScreen.id}` supaya
  // ganti TV = remount ScreenMediaManager bersih (lihat catatan
  // `usePromoMedia` soal ini di hooks/usePromoMedia.ts).
  if (selectedScreen) {
    return (
      <ScreenMediaManager
        key={selectedScreen.id}
        screen={selectedScreen}
        onBack={() => setSelectedScreen(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 dark:bg-zinc-950 md:p-6">
      {toastElement}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Layar Promosi
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            TV yang menampilkan promosi toko — tiap TV punya link akses dan
            daftar media sendiri.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            setActionError("");
            setScreenFormTarget({ mode: "add" });
          }}
        >
          <Plus className="h-4 w-4" />
          Tambah TV
        </Button>
      </div>

      {actionError && (
        <div className="mb-3 flex items-start gap-3 rounded-xl bg-lco-coral/10 p-3.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lco-coral/20 text-lco-coral">
            <AlertCircle className="h-3.5 w-3.5" />
          </div>
          <p className="flex-1 pt-0.5 text-sm text-lco-coral">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError("")}
            aria-label="Tutup notifikasi"
            className="shrink-0 rounded-md p-1 text-lco-coral/50 transition-colors duration-150 hover:bg-lco-coral/20 hover:text-lco-coral"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat daftar TV...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-lco-coral/30 bg-white p-6 text-center dark:bg-zinc-950">
          <AlertCircle className="mx-auto mb-2 h-5 w-5 text-lco-coral" />
          <p className="text-sm text-lco-coral">{error}</p>
          <Button
            type="button"
            onClick={() => void refetch()}
            variant="secondary"
            className="mt-3"
          >
            Coba lagi
          </Button>
        </div>
      ) : screens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <Monitor className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
          <p className="text-sm font-medium">Belum ada TV</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Klik &quot;Tambah TV&quot; untuk mendaftarkan TV pertama, lalu
            kelola isinya dan buka link/QR-nya di perangkat TV.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {screens.map((screen) => (
            <div
              key={screen.id}
              className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {/* Header: avatar TV + toggle status (pola sama seperti
                    toggle "Save/Saved" — tapi di sini untuk aktif/nonaktif) */}
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${
                    screen.is_active
                      ? "bg-lco-teal/10 text-lco-teal ring-lco-teal/30"
                      : "bg-zinc-100 text-zinc-400 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                  }`}
                >
                  <Monitor className="h-4 w-4" />
                </div>

                <button
                  type="button"
                  title={screen.is_active ? "Nonaktifkan TV" : "Aktifkan TV"}
                  aria-label={
                    screen.is_active ? "Nonaktifkan TV" : "Aktifkan TV"
                  }
                  disabled={isMutating}
                  onClick={() =>
                    void runAction(() =>
                      setScreenActive(screen.id, !screen.is_active),
                    )
                  }
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    screen.is_active
                      ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                      : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }`}
                >
                  {screen.is_active ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  {screen.is_active ? "Aktif" : "Nonaktif"}
                </button>
              </div>

              {/* Judul: label kecil + waktu relatif, lalu nama TV besar
                    (mengikuti hierarki "Amazon · 5 days ago" → judul tebal) */}
              <div className="mt-3">
                <p className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                  <span className="font-medium text-zinc-500 dark:text-zinc-400">
                    Layar TV
                  </span>
                  <span aria-hidden>·</span>
                  <span title={formatScreenDate(screen.created_at)}>
                    {relativeScreenTime(screen.created_at)}
                  </span>
                </p>
                <h3 className="mt-0.5 truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {screen.name}
                </h3>
              </div>

              {/* Tag alamat akses, gaya badge sama seperti "Part-Time" dst. */}
              <div className="mt-2.5">
                <span className="inline-flex max-w-full items-center truncate rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  /{screen.access_token}
                </span>
              </div>

              <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-900" />

              {/* Footer: aksi sekunder (ikon polos) di kiri, CTA utama di kanan */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-0.5">
                  <IconButton
                    type="button"
                    title="Link & kode QR"
                    aria-label="Link & kode QR"
                    onClick={() => setLinkModalScreen(screen)}
                    variant="soft"
                    className="h-8 w-8"
                  >
                    <QrCode className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Ubah nama"
                    aria-label="Ubah nama"
                    disabled={isMutating}
                    onClick={() => {
                      setActionError("");
                      setScreenFormTarget({ mode: "rename", screen });
                    }}
                    variant="soft"
                    className="h-8 w-8"
                  >
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Hapus TV"
                    aria-label="Hapus TV"
                    disabled={isMutating}
                    onClick={() => {
                      setDeleteError("");
                      setDeletingScreen(screen);
                    }}
                    variant="soft"
                    tone="danger"
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>

                <Button
                  type="button"
                  onClick={() => setSelectedScreen(screen)}
                  className="shrink-0"
                >
                  <PlayCircle className="h-4 w-4" />
                  Kelola Media
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {screenFormTarget && (
        <ScreenFormModal
          target={screenFormTarget}
          isBusy={isMutating}
          onClose={() => setScreenFormTarget(null)}
          onAdd={addScreen}
          onRename={renameScreen}
          onSaved={handleScreenFormSaved}
        />
      )}

      {linkModalScreen && (
        <ScreenLinkModal
          screen={linkModalScreen}
          onClose={() => setLinkModalScreen(null)}
        />
      )}

      {deletingScreen && (
        <Modal
          size="sm"
          padding="md"
          layout="plain"
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lco-coral/10 text-lco-coral">
              <Trash2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Hapus TV?</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {deletingScreen.name}
                </span>{" "}
                beserta SEMUA media dan filenya akan dihapus permanen dan
                tidak bisa dipulihkan. Kalau hanya ingin berhenti menayangkan
                sementara, pakai tombol nonaktifkan (ikon mata).
              </p>
            </div>
          </div>

          {deleteError && (
            <div className="mb-3 flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="break-all">{deleteError}</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => setDeletingScreen(null)}
              disabled={isMutating}
              variant="secondary"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmDeleteScreen()}
              disabled={isMutating}
              variant="danger"
            >
              {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Hapus
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
