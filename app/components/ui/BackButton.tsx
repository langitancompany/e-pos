"use client";

// ── TAMBAHAN (komponen UI bersama) ── Tombol "← Kembali ke daftar ..." di atas
// halaman detail/form. Sebelumnya class yang sama disalin ke 7 tempat.
//
// Cara pakai (props <button> biasa tetap berlaku: onClick, disabled, dst.):
//   <BackButton onClick={onBack}>Kembali ke daftar hadiah</BackButton>
//
// Catatan: `type` bawaan = "button" (tombol kembali tidak pernah men-submit
// form). Jarak bawah bawaan mb-3; timpa lewat `className` bila perlu.

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ArrowLeft } from "lucide-react";

const BASE_CLASS =
  "inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors duration-150 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-zinc-100";

const BackButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function BackButton(
  { className = "mb-3", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE_CLASS} ${className}`.trim()}
      {...rest}
    >
      <ArrowLeft className="h-4 w-4" />
      {children}
    </button>
  );
});

export default BackButton;
