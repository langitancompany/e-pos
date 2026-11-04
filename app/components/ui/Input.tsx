"use client";

// ── TAMBAHAN (komponen UI bersama) ── Kolom isian teks seragam (text, number,
// date, tel, email, search, password). Tinggi dan gayanya sama persis dengan
// <Select>, jadi sejajar rapi di toolbar/form. Sebelumnya tiap file punya
// konstanta `inputClass` sendiri (18 definisi berbeda).
//
// Cara pakai (props <input> biasa tetap berlaku):
//   <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama" />
//   <Input size="lg" type="date" />
//
// Props:
//   size      "sm" (kolom kecil di dalam baris, mis. jumlah lembar uang) | "md"
//             (default, toolbar/filter) | "lg" (form).
//   fullWidth default TRUE (kolom isian hampir selalu selebar kontainernya);
//             beri fullWidth={false} untuk lebar mengikuti isi.
//   className tambahan khusus (mis. "pl-9" untuk ikon, "font-mono tabular-nums").
//
// Untuk checkbox/radio/file/color tetap pakai <input> biasa.

import { forwardRef, type InputHTMLAttributes } from "react";

export type InputSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<InputSize, string> = {
  sm: "px-2 py-1.5 text-sm",
  md: "px-3 py-2 text-sm",
  lg: "px-3 py-2.5 text-sm",
};

export const INPUT_BASE_CLASS =
  "rounded-md border border-zinc-300 bg-white text-zinc-900 outline-none transition-colors duration-150 placeholder:text-zinc-400 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:disabled:bg-zinc-800";

/** Gabungan class dasar + ukuran (+ lebar penuh). Dipakai juga oleh Textarea & MoneyInput. */
export function inputClassName(size: InputSize, fullWidth: boolean): string {
  return `${INPUT_BASE_CLASS} ${SIZE_CLASS[size]}${fullWidth ? " w-full" : ""}`;
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: InputSize;
  fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", fullWidth = true, className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`${inputClassName(size, fullWidth)} ${className}`.trim()}
      {...rest}
    />
  );
});

export default Input;
