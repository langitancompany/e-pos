"use client";

// Satu tombol "Tambah Produk" yang membuka tiga pilihan. Pola menu mengikuti
// UserMenu.tsx: tutup lewat klik di luar, Escape, atau fokus keluar dari menu.
// Ikon dipilih sesuai aksinya: pensil untuk isi manual, panah naik untuk
// unggah file, panah turun untuk unduh template.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Download, Loader2, Pencil, Plus, Upload } from "lucide-react";
import Button from "@/app/components/ui/Button";

interface ProdukAddMenuProps {
  onManual: () => void;
  onUpload: () => void;
  onTemplate: () => void;
  /** Template sedang dibuat, pilihan Download template dinonaktifkan. */
  templateBusy?: boolean;
  /** "end" menempel ke tepi kanan tombol di layar lebar, "center" di tengah tombol. */
  align?: "end" | "center";
  className?: string;
}

const ALIGN_CLASS = {
  end: "left-0 md:left-auto md:right-0",
  center: "left-1/2 -translate-x-1/2",
} as const;

export default function ProdukAddMenu({
  onManual,
  onUpload,
  onTemplate,
  templateBusy = false,
  align = "end",
  className = "",
}: ProdukAddMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    items[next].focus();
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  const itemClass =
    "flex min-h-11 w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-150 hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lco-teal disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900 dark:focus-visible:bg-zinc-900";
  const iconClass = "mt-0.5 h-4 w-4 shrink-0 text-lco-green dark:text-lco-teal";

  return (
    <div
      ref={rootRef}
      className={`relative inline-block ${className}`.trim()}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        size="lg"
        className="min-h-11"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Tambah Produk
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </Button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Cara menambah produk"
          onKeyDown={handleMenuKeyDown}
          className={`absolute top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-1 text-left shadow-lg dark:border-zinc-800 dark:bg-zinc-950 ${ALIGN_CLASS[align]}`}
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => choose(onManual)}
          >
            <Pencil className={iconClass} aria-hidden="true" />
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Buat produk manual
              </span>
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                Isi satu produk lewat formulir.
              </span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => choose(onUpload)}
          >
            <Upload className={iconClass} aria-hidden="true" />
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Upload Excel
              </span>
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                Tambah banyak produk sekaligus dari file .xlsx.
              </span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={templateBusy}
            onClick={() => choose(onTemplate)}
          >
            {templateBusy ? (
              <Loader2 className={`${iconClass} animate-spin motion-reduce:animate-none`} aria-hidden="true" />
            ) : (
              <Download className={iconClass} aria-hidden="true" />
            )}
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {templateBusy ? "Menyiapkan template..." : "Download template"}
              </span>
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                File Excel dengan dropdown kategori dan jenis produk.
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
