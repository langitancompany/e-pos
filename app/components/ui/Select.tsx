"use client";

// ── TAMBAHAN (komponen UI bersama) ── Dropdown seragam untuk seluruh aplikasi.
// Sebelumnya tiap modul menulis class <select>-nya sendiri (9 variasi berbeda),
// sehingga tampilan dan jarak panahnya tidak konsisten. Sekarang SEMUA dropdown
// memakai komponen ini.
//
// Panah (chevron) digambar oleh aturan global `select` di app/globals.css
// (lengkap dengan jarak dari tepi kanan + varian mode gelap), jadi komponen ini
// hanya mengurus warna, border, fokus, dan ukuran.
//
// Cara pakai (props select biasa tetap berlaku: value, onChange, disabled,
// aria-label, children <option>, dst.):
//   <Select value={x} onChange={(e) => setX(e.target.value)} aria-label="Urutkan">
//     <option value="a">A</option>
//   </Select>
//
// Props tambahan:
//   size      "xs" | "sm" | "md" (default) | "lg" — tinggi/ukuran teks.
//             Pilih yang tingginya sama dengan input di sebelahnya
//             (input form umumnya "lg", toolbar filter umumnya "md").
//   fullWidth true -> w-full (default: lebar mengikuti isi / kontainer flex).
//   className tambahan khusus (mis. "min-w-40"); jangan dipakai untuk
//             mengubah warna/border supaya tampilan tetap seragam.

import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<SelectSize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-2.5 py-2 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-3 py-2.5 text-sm",
};

const BASE_CLASS =
  "rounded-md border border-zinc-300 bg-white text-zinc-900 outline-none transition-colors duration-150 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:disabled:bg-zinc-800";

interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: SelectSize;
  fullWidth?: boolean;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = "md", fullWidth = false, className = "", children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={`${BASE_CLASS} ${SIZE_CLASS[size]} ${
        fullWidth ? "w-full" : ""
      } ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  );
});

export default Select;
