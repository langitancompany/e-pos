"use client";

// app/components/promo/ScreenFormModal.tsx
// ── Dipecah dari PromoModule.tsx (lihat catatan di file itu). Isi dipindah
// apa adanya, tanpa perubahan logika.

import { useState } from "react";
import {
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import {
  slugifyScreenToken,
  type PromoScreen,
  type PromoScreenActionResult,
} from "@/hooks/usePromoScreens";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import IconButton from "@/app/components/ui/IconButton";
import { LABEL_CLASS } from "./promoUtils";

// ── Modal tambah / ubah nama TV ─────────────────────────────────────────

export type ScreenFormTarget =
  | { mode: "add" }
  | { mode: "rename"; screen: PromoScreen };

export default function ScreenFormModal({
  target,
  isBusy,
  onClose,
  onAdd,
  onRename,
  onSaved,
}: {
  target: ScreenFormTarget;
  isBusy: boolean;
  onClose: () => void;
  onAdd: (
    name: string,
    customSlug?: string,
  ) => Promise<PromoScreenActionResult>;
  onRename: (id: string, name: string) => Promise<PromoScreenActionResult>;
  onSaved: (message: string) => void;
}) {
  const renameTarget = target.mode === "rename" ? target.screen : null;
  const isRename = renameTarget !== null;

  const [name, setName] = useState(renameTarget ? renameTarget.name : "");
  // Hanya dipakai saat TAMBAH TV — mengubah access_token TV yang sudah ada
  // akan mematahkan link/QR yang sudah ditempel di perangkat itu, jadi
  // sengaja tidak ditawarkan di form "Ubah Nama" (lihat catatan di
  // `usePromoScreens.ts`: tidak ada fungsi regenerate token).
  const [customSlug, setCustomSlug] = useState("");
  const [formError, setFormError] = useState("");

  const slugPreview = customSlug.trim() ? slugifyScreenToken(customSlug) : null;
  const slugLooksInvalid = customSlug.trim().length > 0 && !slugPreview;

  async function handleSubmit() {
    setFormError("");
    if (!name.trim()) {
      setFormError("Nama TV wajib diisi.");
      return;
    }
    if (!isRename && slugLooksInvalid) {
      setFormError(
        "Alamat TV tidak valid — minimal 3 karakter, huruf kecil/angka/tanda hubung saja.",
      );
      return;
    }

    const result = renameTarget
      ? await onRename(renameTarget.id, name)
      : await onAdd(name, customSlug);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onSaved(isRename ? "Nama TV disimpan." : "TV baru ditambahkan.");
  }

  return (
    <Modal
      size="sm"
      padding="none"
      layout="plain"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">
          {isRename ? "Ubah Nama TV" : "Tambah TV"}
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

      <div className="space-y-4 p-5">
        <div>
          <label className={LABEL_CLASS}>Nama TV</label>
          <Input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isBusy}
            maxLength={80}
            placeholder="Mis. TV Kasir Depan"
            size="lg"
            autoFocus
          />
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Hanya penanda di daftar ini — tidak tampil di layar TV itu
            sendiri.
          </p>
        </div>

        {!isRename && (
          <div>
            <label className={LABEL_CLASS}>Alamat TV (opsional)</label>
            <Input
              type="text"
              value={customSlug}
              onChange={(event) => setCustomSlug(event.target.value)}
              disabled={isBusy}
              maxLength={64}
              placeholder="Mis. kasir-depan (kosongkan untuk kode acak)"
              size="lg"
            />
            <p
              className={`mt-1.5 text-xs ${
                slugLooksInvalid
                  ? "text-lco-coral"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {customSlug.trim()
                ? slugLooksInvalid
                  ? "Minimal 3 karakter, huruf kecil/angka/tanda hubung saja."
                  : `Link jadi: .../tv/${slugPreview}`
                : "Kosongkan supaya link tetap acak & aman ditebak (disarankan). Isi hanya kalau ingin link pendek yang mudah diketik ulang manual di perangkat TV."}
            </p>
          </div>
        )}

        {formError && (
          <div className="flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-xs text-lco-coral dark:bg-zinc-950">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{formError}</p>
          </div>
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
          {isRename ? "Simpan" : "Tambah"}
        </Button>
      </div>
    </Modal>
  );
}
