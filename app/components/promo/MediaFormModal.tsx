"use client";

// app/components/promo/MediaFormModal.tsx
// ── Dipecah dari PromoModule.tsx (lihat catatan di file itu). Isi dipindah
// apa adanya, tanpa perubahan logika.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import {
  PROMO_ACCEPT,
  PROMO_DURATION_DEFAULT,
  PROMO_DURATION_MAX,
  PROMO_DURATION_MIN,
  PROMO_MAX_FILE_BYTES,
  type AddPromoMediaInput,
  type PromoActionResult,
  type PromoMedia,
  type UpdatePromoMediaInput,
} from "@/hooks/usePromoMedia";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import IconButton from "@/app/components/ui/IconButton";
import { formatFileSize, LABEL_CLASS } from "./promoUtils";

// ── Modal tambah / ubah media (SAMA seperti sesi #20, tidak berubah) ────

export type MediaFormTarget = { mode: "add" } | { mode: "edit"; item: PromoMedia };

interface MediaFormModalProps {
  target: MediaFormTarget;
  isBusy: boolean;
  onClose: () => void;
  onAdd: (input: AddPromoMediaInput) => Promise<PromoActionResult>;
  onEdit: (
    id: string,
    patch: UpdatePromoMediaInput,
  ) => Promise<PromoActionResult>;
  onSaved: (message: string) => void;
}

// Dirender HANYA saat `target` ada (lihat ScreenMediaManager di bawah), jadi
// state awalnya cukup diisi lewat useState initializer — tidak perlu
// useEffect untuk mereset form tiap dibuka.
export default function MediaFormModal({
  target,
  isBusy,
  onClose,
  onAdd,
  onEdit,
  onSaved,
}: MediaFormModalProps) {
  // `editItem` (bukan alias boolean) supaya TypeScript pasti menyempitkan tipe.
  const editItem = target.mode === "edit" ? target.item : null;
  const isEdit = editItem !== null;

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(editItem ? editItem.title : "");
  const [duration, setDuration] = useState(
    String(editItem ? editItem.duration_seconds : PROMO_DURATION_DEFAULT),
  );
  const [formError, setFormError] = useState("");

  // URL pratinjau file lokal. Dibuat di event handler (bukan saat render)
  // dan WAJIB di-revoke kalau diganti/modal ditutup, kalau tidak bocor di
  // memori tab (TV/tablet kasir dibuka seharian).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = picked ? URL.createObjectURL(picked) : null;
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setFile(picked);

    // Judul otomatis dari nama file kalau belum diisi — bisa diubah.
    if (picked && !title.trim()) {
      setTitle(picked.name.replace(/\.[^.]+$/, ""));
    }

    // Video tidak dikompres di browser, jadi ukurannya bisa dicek langsung.
    // (Gambar dicek SETELAH kompresi, di hook.)
    if (
      picked &&
      picked.type.startsWith("video/") &&
      picked.size > PROMO_MAX_FILE_BYTES
    ) {
      setFormError(
        `Video ${formatFileSize(picked.size)} melebihi batas ${formatFileSize(PROMO_MAX_FILE_BYTES)}. Kecilkan/kompres videonya dulu.`,
      );
    } else {
      setFormError("");
    }
  }

  const isImage = editItem
    ? editItem.media_type === "image"
    : file
      ? file.type.startsWith("image/")
      : false;
  const isVideoPicked = !isEdit && !!file && file.type.startsWith("video/");

  async function handleSubmit() {
    setFormError("");

    if (!editItem) {
      if (!file) {
        setFormError("Pilih file gambar atau video dulu.");
        return;
      }
      const result = await onAdd({
        file,
        title,
        durationSeconds: Number(duration),
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onSaved("Media berhasil ditambahkan.");
      return;
    }

    const patch: UpdatePromoMediaInput = { title };
    if (editItem.media_type === "image") {
      patch.duration_seconds = Number(duration);
    }
    const result = await onEdit(editItem.id, patch);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onSaved("Perubahan disimpan.");
  }

  return (
    <Modal
      size="lg"
      padding="none"
      layout="flex"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">
          {isEdit ? "Ubah Media" : "Tambah Media"}
        </h3>
        <IconButton
          type="button"
          onClick={onClose}
          disabled={isBusy}
          aria-label="Tutup"
          variant="soft"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="space-y-4 overflow-y-auto p-5">
        {!isEdit && (
          <div>
            <label className={LABEL_CLASS}>File (gambar atau video)</label>
            <input
              type="file"
              accept={PROMO_ACCEPT}
              onChange={handleFileChange}
              disabled={isBusy}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 file:transition-colors file:duration-150 hover:file:bg-zinc-50 disabled:opacity-60 dark:text-zinc-400 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-200 dark:hover:file:bg-zinc-800"
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              JPG, PNG, WebP, MP4, atau WebM. Maksimal{" "}
              <span className="font-mono tabular-nums">
                {formatFileSize(PROMO_MAX_FILE_BYTES)}
              </span>
              . Video terbaik: MP4 (H.264), 1080p.
            </p>
          </div>
        )}

        {previewUrl && file && (
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
            {isVideoPicked ? (
              <video
                src={previewUrl}
                controls
                muted
                playsInline
                className="mx-auto max-h-56 w-full"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- pratinjau file lokal (blob:), tidak bisa dioptimasi next/image
              <img
                src={previewUrl}
                alt="Pratinjau"
                className="mx-auto max-h-56 w-full object-contain"
              />
            )}
          </div>
        )}

        <div>
          <label className={LABEL_CLASS}>Judul</label>
          <Input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={isBusy}
            maxLength={120}
            placeholder="Mis. Promo Kaos Oktober"
            size="lg"
          />
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Hanya untuk penanda di daftar ini — tidak tampil di layar TV.
          </p>
        </div>

        {isImage && (
          <div>
            <label className={LABEL_CLASS}>Lama tayang (detik)</label>
            <Input
              type="number"
              inputMode="numeric"
              min={PROMO_DURATION_MIN}
              max={PROMO_DURATION_MAX}
              step={1}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              disabled={isBusy}
              size="lg" className="font-mono tabular-nums"
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {PROMO_DURATION_MIN}–{PROMO_DURATION_MAX} detik. Video diputar
              sampai selesai.
            </p>
          </div>
        )}

        {formError && (
          <div className="flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{formError}</p>
          </div>
        )}

        {isBusy && !isEdit && (
          <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Mengunggah... jangan tutup halaman ini (video besar bisa butuh
            beberapa menit).
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <Button
          type="button"
          onClick={onClose}
          disabled={isBusy}
          variant="secondary"
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isBusy}
        >
          {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "Simpan" : "Unggah"}
        </Button>
      </div>
    </Modal>
  );
}
