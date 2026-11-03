"use client";

// ── TAMBAHAN (komponen UI bersama) ── Tombol yang isinya HANYA ikon (tutup,
// hapus, ubah, kembali, dst.). Sebelumnya tiap modul menulis class sendiri
// (p-1 / p-1.5 / p-2, warna hover berbeda-beda) dan sering lupa aria-label.
//
// `aria-label` WAJIB (dicek TypeScript) karena tombol ikon tidak punya teks
// yang bisa dibaca screen reader.
//
// Cara pakai (props <button> biasa tetap berlaku: onClick, disabled, dst.):
//   <IconButton aria-label="Tutup" onClick={onClose}><X className="h-4 w-4" /></IconButton>
//   <IconButton aria-label="Hapus" tone="danger" variant="soft"><Trash2 className="h-4 w-4" /></IconButton>
//
// Props:
//   variant  "plain" (default: hanya warna ikon berubah saat hover — cocok
//            untuk tombol tutup) | "soft" (ada latar abu saat hover — cocok
//            untuk tombol di baris tabel/daftar).
//   tone     "neutral" (default) | "danger" (hover jadi merah).
//   size     "sm" (p-1) | "md" (p-1.5, default) | "lg" (p-2).
//   className hanya untuk margin/posisi (mis. "ml-auto", "shrink-0").
//
// Catatan: `type` TIDAK diberi nilai bawaan (sama seperti Button) — pakai
// type="button" bila tombol berada di dalam <form>.

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type IconButtonVariant = "plain" | "soft";
export type IconButtonTone = "neutral" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<IconButtonVariant, Record<IconButtonTone, string>> =
  {
    plain: {
      neutral:
        "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200",
      danger: "text-zinc-400 hover:text-lco-coral",
    },
    soft: {
      neutral:
        "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
      danger:
        "text-zinc-400 hover:bg-lco-coral/10 hover:text-lco-coral",
    },
  };

const SIZE_CLASS: Record<IconButtonSize, string> = {
  sm: "p-1",
  md: "p-1.5",
  lg: "p-2",
};

const BASE_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Wajib: nama aksi untuk screen reader, mis. "Tutup". */
  "aria-label": string;
  variant?: IconButtonVariant;
  tone?: IconButtonTone;
  size?: IconButtonSize;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      variant = "plain",
      tone = "neutral",
      size = "md",
      className = "",
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={`${BASE_CLASS} ${VARIANT_CLASS[variant][tone]} ${SIZE_CLASS[size]} ${className}`.trim()}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export default IconButton;
