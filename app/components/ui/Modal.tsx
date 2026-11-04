"use client";

// ── TAMBAHAN (komponen UI bersama) ── Kerangka dialog/modal seragam: lapisan
// gelap di belakang + kartu putih di tengah. Sebelumnya pasangan <div> overlay
// + <div> kartu ini disalin ke 20+ tempat dengan opasitas, bayangan, dan
// batas tinggi yang berbeda-beda.
//
// Modal hanya mengurus KERANGKA. Isi (judul, form, tombol) tetap ditulis di
// dalamnya; untuk judul + tombol tutup standar ada <ModalHeader>.
//
// Cara pakai:
//   <Modal size="md" aria-label="Batalkan catatan kas">
//     <ModalHeader title="Batalkan Catatan Kas" onClose={onClose} />
//     ...isi...
//   </Modal>
//
// Props:
//   size      "sm" | "md" | "lg" | "xl" | "2xl" — lebar maksimum kartu.
//   padding   "lg" (p-6, default) | "md" (p-5) | "none" (isi mengatur sendiri,
//             mis. header/footer bergaris).
//   layout    "scroll" (default: isi memanjang -> kartu bisa digulir)
//             | "flex" (kolom flex; area isi sendiri yang digulir, untuk header
//               + isi + footer tetap) | "clip" | "plain".
//   placement "center" (default) | "sheet" — di layar kecil kartu menempel di
//             bawah seperti bottom sheet (sudut atas membulat), di layar
//             sm ke atas tetap di tengah.
//   onBackdropClick  opsional — dipanggil kalau area gelap di luar kartu
//             diklik. SENGAJA tidak aktif bawaan supaya form yang sedang diisi
//             tidak tertutup tidak sengaja.
//   Props div lain (aria-label, id, dst.) diteruskan ke kartu.

import type { HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

const PADDING_CLASS = {
  none: "",
  md: "p-5",
  lg: "p-6",
} as const;

const LAYOUT_CLASS = {
  scroll: "max-h-[90vh] overflow-y-auto",
  flex: "flex max-h-[90vh] flex-col overflow-hidden",
  clip: "overflow-hidden",
  plain: "",
} as const;

const PLACEMENT_OVERLAY_CLASS = {
  center: "items-center p-4",
  sheet: "items-end p-0 sm:items-center sm:p-4",
} as const;

const PLACEMENT_CARD_CLASS = {
  center: "rounded-xl",
  sheet: "rounded-t-xl sm:rounded-xl",
} as const;

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  size?: ModalSize;
  placement?: keyof typeof PLACEMENT_OVERLAY_CLASS;
  padding?: keyof typeof PADDING_CLASS;
  layout?: keyof typeof LAYOUT_CLASS;
  onBackdropClick?: () => void;
  children: ReactNode;
}

export default function Modal({
  size = "md",
  placement = "center",
  padding = "lg",
  layout = "scroll",
  onBackdropClick,
  className = "",
  children,
  ...rest
}: ModalProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-zinc-950/40 ${PLACEMENT_OVERLAY_CLASS[placement]}`}
      onMouseDown={
        onBackdropClick
          ? (e) => {
              if (e.target === e.currentTarget) onBackdropClick();
            }
          : undefined
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${SIZE_CLASS[size]} ${PLACEMENT_CARD_CLASS[placement]} border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 ${PADDING_CLASS[padding]} ${LAYOUT_CLASS[layout]} ${className}`
          .replace(/\s+/g, " ")
          .trim()}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  title: ReactNode;
  /** Ikon kecil di kiri judul, mis. <Lock className="h-4 w-4 text-lco-coral" />. */
  icon?: ReactNode;
  /** Kalau diisi, tombol tutup (X) muncul di kanan. */
  onClose?: () => void;
  /** Menonaktifkan tombol tutup (mis. saat sedang menyimpan). */
  closeDisabled?: boolean;
  className?: string;
}

export function ModalHeader({
  title,
  icon,
  onClose,
  closeDisabled = false,
  className = "mb-4",
}: ModalHeaderProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h3>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Tutup"
          className="text-zinc-400 transition-colors duration-150 hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
