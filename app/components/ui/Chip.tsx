"use client";

// ── TAMBAHAN (komponen UI bersama) ── Tombol pilihan/filter yang punya status
// "terpilih" (chip filter, pilihan jenis, toggle dua opsi). Sebelumnya tiap
// modul menulis ulang template class `${terpilih ? "border-lco-teal ..." :
// "border-zinc-200 ..."}` dengan variasi kecil di ±20 tempat.
//
// Cara pakai (props <button> biasa tetap berlaku: onClick, disabled, dst.):
//   <Chip selected={range === 7} onClick={() => setRange(7)}>7 Hari</Chip>
//   <Chip shape="pill" selected={isActive} onClick={toggle}>Aktif</Chip>
//   <Chip size="lg" tone="danger" selected={isOut} onClick={setOut}>
//     <ArrowUpRight className="h-4 w-4" /> Kas Keluar
//   </Chip>
//
// Props:
//   selected  status terpilih. Otomatis diteruskan ke aria-pressed.
//   variant   "outline" (default: terpilih = border + latar tipis berwarna)
//             | "solid" (terpilih = latar penuh, teks putih).
//   tone      "primary" (default, teal/hijau tema) | "danger" (merah) —
//             warna saat TERPILIH.
//   shape     "rounded" (default) | "pill" (membulat penuh).
//   size      "xs" (px-2 py-1, 11px) | "sm" (default) | "md" | "lg"
//             (px-3 py-2.5, text-sm, untuk pilihan besar berikon).
//   className untuk margin/posisi/lebar saja (mis. "flex-1", "mt-2").
//
// Catatan: `type` bawaan = "button" (chip tidak pernah men-submit form).

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ChipVariant = "outline" | "solid";
export type ChipTone = "primary" | "danger";
export type ChipShape = "rounded" | "pill";
export type ChipSize = "xs" | "sm" | "md" | "lg";

const BASE_CLASS =
  "inline-flex items-center justify-center gap-1.5 border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60";

const SHAPE_CLASS: Record<ChipShape, string> = {
  rounded: "rounded-md",
  pill: "rounded-full",
};

const SIZE_CLASS: Record<ChipSize, string> = {
  xs: "px-2 py-1 text-[11px]",
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-xs",
  lg: "px-3 py-2.5 text-sm font-semibold",
};

const IDLE_CLASS =
  "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:text-zinc-100";

const SELECTED_CLASS: Record<ChipVariant, Record<ChipTone, string>> = {
  outline: {
    primary:
      "border-lco-teal bg-lco-teal/10 text-lco-green dark:text-lco-teal",
    danger: "border-lco-coral bg-lco-coral/10 text-lco-coral",
  },
  solid: {
    primary: "border-lco-green bg-lco-green text-white",
    danger: "border-lco-coral bg-lco-coral text-white",
  },
};

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  variant?: ChipVariant;
  tone?: ChipTone;
  shape?: ChipShape;
  size?: ChipSize;
}

const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    selected = false,
    variant = "outline",
    tone = "primary",
    shape = "rounded",
    size = "sm",
    type = "button",
    className = "",
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={`${BASE_CLASS} ${SHAPE_CLASS[shape]} ${SIZE_CLASS[size]} ${
        selected ? SELECTED_CLASS[variant][tone] : IDLE_CLASS
      } ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Chip;
