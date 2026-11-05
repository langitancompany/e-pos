"use client";

// app/components/promo/ScreenMediaManager.tsx
// ── Dipecah dari PromoModule.tsx (lihat catatan di file itu). Isi dipindah
// apa adanya, tanpa perubahan logika.

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  QrCode,
  Trash2,
  Upload,
} from "lucide-react";
import {
  usePromoMedia,
  type PromoActionResult,
  type PromoMedia,
} from "@/hooks/usePromoMedia";
import {
  type PromoScreen,
} from "@/hooks/usePromoScreens";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import BackButton from "@/app/components/ui/BackButton";
import { formatFileSize } from "./promoUtils";
import ScreenLinkModal from "./ScreenLinkModal";
import MediaFormModal, { type MediaFormTarget } from "./MediaFormModal";

// ── Tingkat 2: kelola media SATU TV ─────────────────────────────────────
// Isi bawah ini hampir seluruhnya kode lama sesi #20 (upload, urutan,
// aktif/nonaktif, hapus media) — cuma sekarang discope ke `screen.id` lewat
// `usePromoMedia(screen.id)`, dan header diganti menampilkan info TV yang
// sedang dikelola (bukan lagi alamat /tv global).

export default function ScreenMediaManager({
  screen,
  onBack,
}: {
  screen: PromoScreen;
  onBack: () => void;
}) {
  const {
    items,
    isLoading,
    error,
    isMutating,
    refetch,
    addMedia,
    updateMedia,
    removeMedia,
    moveItem,
  } = usePromoMedia(screen.id);

  const [formTarget, setFormTarget] = useState<MediaFormTarget | null>(null);
  const [deletingItem, setDeletingItem] = useState<PromoMedia | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showLinkModal, setShowLinkModal] = useState(false);

  async function runAction(
    action: () => Promise<PromoActionResult>,
    successText?: string,
  ) {
    setActionError("");
    setSuccessMessage("");
    const result = await action();
    if (!result.ok) {
      setActionError(result.error);
    } else if (successText) {
      setSuccessMessage(successText);
    }
  }

  function handleFormSaved(message: string) {
    setFormTarget(null);
    setActionError("");
    setSuccessMessage(message);
  }

  async function handleConfirmDelete() {
    if (!deletingItem) return;
    setDeleteError("");

    const result = await removeMedia(deletingItem.id);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeletingItem(null);
    setActionError("");
    setSuccessMessage("Media dihapus.");
  }

  const activeCount = items.filter((item) => item.is_active).length;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 dark:bg-zinc-950 md:p-6">
      <BackButton onClick={onBack}>Daftar TV</BackButton>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {screen.name}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Gambar dan video yang diputar berulang di TV ini.
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            onClick={() => setShowLinkModal(true)}
            variant="secondary"
          >
            <QrCode className="h-4 w-4" />
            Link & QR
          </Button>
          <Button
            type="button"
            onClick={() => {
              setActionError("");
              setSuccessMessage("");
              setFormTarget({ mode: "add" });
            }}
          >
            <Plus className="h-4 w-4" />
            Tambah Media
          </Button>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500 dark:text-zinc-400">
          <li>
            Gambar tayang sesuai durasinya; video diputar sampai selesai, tanpa
            suara.
          </li>
          <li>
            Perubahan di daftar ini muncul di TV ini dalam sekitar 1 menit tanpa
            perlu memuat ulang.
          </li>
          <li>
            Media di sini HANYA tayang di{" "}
            <span className="font-medium">{screen.name}</span> — TV lain punya
            daftarnya sendiri. Klik &quot;Link &amp; QR&quot; untuk alamat TV
            ini.
          </li>
        </ul>
      </div>

      {successMessage && (
        <div className="mb-3 flex items-start gap-2 border border-lco-teal/40 bg-white p-3 text-xs text-lco-green dark:bg-zinc-950 dark:text-lco-teal">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      {actionError && (
        <div className="mb-3 flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{actionError}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat daftar media...
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
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <Upload className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
          <p className="text-sm font-medium">Belum ada media</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Klik &quot;Tambah Media&quot; untuk mengunggah gambar atau video
            pertama. Selama kosong, TV ini menampilkan layar tunggu.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-mono tabular-nums">{items.length}</span> media
            · <span className="font-mono tabular-nums">{activeCount}</span>{" "}
            tayang di TV ini
          </p>

          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="w-6 shrink-0 text-center font-mono text-sm tabular-nums text-zinc-400">
                  {index + 1}
                </span>

                <div
                  className={`relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-zinc-950 ${
                    item.is_active ? "" : "opacity-40"
                  }`}
                >
                  {item.media_type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL publik Supabase Storage, tampilan kecil
                    <img
                      src={item.file_url}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <>
                      {/* #t=0.1 supaya browser menampilkan satu frame sebagai gambar mini */}
                      <video
                        src={`${item.file_url}#t=0.1`}
                        preload="metadata"
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                      />
                      <PlayCircle className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white/80" />
                    </>
                  )}
                </div>

                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {item.media_type === "image" ? (
                      <>
                        Gambar ·{" "}
                        <span className="font-mono tabular-nums">
                          {item.duration_seconds}
                        </span>{" "}
                        dtk
                      </>
                    ) : (
                      <>Video · sampai selesai</>
                    )}{" "}
                    ·{" "}
                    <span className="font-mono tabular-nums">
                      {formatFileSize(item.file_size)}
                    </span>
                  </p>
                  <p
                    className={`mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                      item.is_active
                        ? "text-lco-green dark:text-lco-teal"
                        : "text-zinc-400"
                    }`}
                  >
                    {item.is_active ? "Tayang" : "Disembunyikan"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <IconButton
                    type="button"
                    title="Naikkan urutan"
                    aria-label="Naikkan urutan"
                    disabled={isMutating || index === 0}
                    onClick={() =>
                      void runAction(() => moveItem(item.id, "up"))
                    }
                    variant="outlined"
                    className="h-8 w-8"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Turunkan urutan"
                    aria-label="Turunkan urutan"
                    disabled={isMutating || index === items.length - 1}
                    onClick={() =>
                      void runAction(() => moveItem(item.id, "down"))
                    }
                    variant="outlined"
                    className="h-8 w-8"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    title={
                      item.is_active ? "Sembunyikan dari TV" : "Tayangkan di TV"
                    }
                    aria-label={
                      item.is_active ? "Sembunyikan dari TV" : "Tayangkan di TV"
                    }
                    disabled={isMutating}
                    onClick={() =>
                      void runAction(() =>
                        updateMedia(item.id, { is_active: !item.is_active }),
                      )
                    }
                    variant="outlined"
                    className="h-8 w-8"
                  >
                    {item.is_active ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Ubah judul / durasi"
                    aria-label="Ubah judul / durasi"
                    disabled={isMutating}
                    onClick={() => {
                      setActionError("");
                      setSuccessMessage("");
                      setFormTarget({ mode: "edit", item });
                    }}
                    variant="outlined"
                    className="h-8 w-8"
                  >
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Hapus"
                    aria-label="Hapus"
                    disabled={isMutating}
                    onClick={() => {
                      setDeleteError("");
                      setDeletingItem(item);
                    }}
                    variant="outlined"
                    tone="danger"
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {formTarget && (
        <MediaFormModal
          target={formTarget}
          isBusy={isMutating}
          onClose={() => setFormTarget(null)}
          onAdd={addMedia}
          onEdit={updateMedia}
          onSaved={handleFormSaved}
        />
      )}

      {showLinkModal && (
        <ScreenLinkModal
          screen={screen}
          onClose={() => setShowLinkModal(false)}
        />
      )}

      {/* Konfirmasi hapus — overlay & radius disamakan dengan modal Hapus
          produk di ProdukModule.tsx. Beda penting: di sini hapus PERMANEN
          (tidak ada Sampah untuk media promosi, lihat migration 026/027). */}
      {deletingItem && (
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
              <h3 className="text-sm font-semibold">Hapus media?</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {deletingItem.title}
                </span>{" "}
                akan dihapus permanen beserta filenya dan tidak bisa
                dipulihkan. Kalau hanya ingin berhenti menayangkan sementara,
                pakai tombol sembunyikan (ikon mata).
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
              onClick={() => setDeletingItem(null)}
              disabled={isMutating}
              variant="secondary"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmDelete()}
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
