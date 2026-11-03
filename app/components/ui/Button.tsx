"use client";

// ── TAMBAHAN (komponen UI bersama) ── Tombol seragam. Sebelumnya ada puluhan
// variasi class tombol (hijau, bergaris, merah) yang ditulis ulang di tiap
// modul. Sekarang cukup pilih `variant` dan `size`.
//
// Cara pakai (props <button> biasa tetap berlaku: onClick, disabled, type, dst.):
//   <Button variant="primary" onClick={save}>Simpan</Button>
//   <Button variant="secondary" size="sm" onClick={close}>Batal</Button>
//   <Button variant="danger" fullWidth disabled={saving}>Hapus</Button>
//
// Catatan: `type` TIDAK diberi nilai bawaan (sama seperti <button> biasa,
// bawaan browser = "submit"), jadi tombol submit di dalam <form> tetap bekerja.
// Tombol non-submit tetap perlu type="button" seperti sebelumnya.
//
// Props:
//   variant   "primary" (hijau, aksi utama) | "secondary" (bergaris, aksi
//             sekunder/batal) | "danger" (merah, aksi merusak) | "ghost"
//             (tanpa latar, aksi ringan).
//   size      "sm" | "md" (default) | "lg".
//   fullWidth true -> w-full.
//   className hanya untuk margin/posisi (mis. "mt-5", "flex-1").

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-lco-green text-white hover:bg-lco-green-hover",
  secondary:
    "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900",
  danger: "bg-lco-coral text-white hover:bg-lco-coral/90",
  ghost:
    "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm",
};

const BASE_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth = false,
    className = "",
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${
        fullWidth ? "w-full" : ""
      } ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Button;
