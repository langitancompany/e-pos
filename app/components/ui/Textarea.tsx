"use client";

// ── TAMBAHAN (komponen UI bersama) ── Kolom isian teks banyak baris. Gayanya
// sama persis dengan <Input> (border, fokus, mode gelap), supaya catatan /
// keterangan di semua form tampil seragam. Sebelumnya tiap file menyalin class
// <input> lalu menambah "resize-none".
//
// Cara pakai (props <textarea> biasa tetap berlaku: rows, maxLength, dst.):
//   <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
//
// Props:
//   size      "md" (default) | "lg" — sama seperti <Input>.
//   fullWidth default TRUE.
//   resize    false (default) -> tidak bisa ditarik ukurannya; true -> bebas.
//   className tambahan khusus saja.

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { inputClassName, type InputSize } from "./Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: InputSize;
  fullWidth?: boolean;
  resize?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { size = "md", fullWidth = true, resize = false, className = "", ...rest },
    ref,
  ) {
    return (
      <textarea
        ref={ref}
        className={`${inputClassName(size, fullWidth)} ${
          resize ? "" : "resize-none"
        } ${className}`.trim()}
        {...rest}
      />
    );
  },
);

export default Textarea;
