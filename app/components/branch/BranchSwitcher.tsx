"use client";

// app/components/branch/BranchSwitcher.tsx
// ── BARU (migration 047, multi cabang) ── Pemilih cabang di Header, di KIRI tombol
// "Buka Kasir". Daftar yang tampil sudah otomatis hanya cabang yang boleh diakses
// user (disaring database lewat RLS) — user tanpa batasan melihat semua cabang.
//
// - 2+ cabang  : tombol dropdown untuk pindah cabang.
// - 1 cabang   : lencana statis (tidak ada yang bisa dipilih).
// - 0 cabang   : memakai `fallbackName` (mis. migration 047 belum dijalankan).

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Store } from "lucide-react";
import { useActiveBranch } from "@/hooks/useActiveBranch";

const badgeClass =
  "flex shrink-0 items-center gap-1.5 rounded-full bg-lco-green/10 px-3 py-1.5 text-xs font-medium text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal";

export default function BranchSwitcher({ fallbackName }: { fallbackName: string }) {
  const { branches, activeBranch, setActiveBranch, isLoading } = useActiveBranch();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const choices = branches.filter((b) => b.is_active);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = activeBranch?.name ?? (isLoading ? "…" : fallbackName);

  if (choices.length <= 1) {
    return (
      <div className={`hidden sm:flex ${badgeClass}`}>
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[180px] truncate">{label}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Ganti cabang"
        className={`${badgeClass} cursor-pointer transition-colors duration-150 hover:bg-lco-green/20 dark:hover:bg-lco-teal/25`}
      >
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[120px] truncate sm:max-w-[180px]">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Pilih cabang"
          className="absolute right-0 top-full z-30 mt-2 max-h-80 w-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <li className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Pilih cabang
          </li>
          {choices.map((b) => {
            const selected = b.id === activeBranch?.id;
            return (
              <li key={b.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveBranch(b.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                    selected ? "font-semibold text-lco-green dark:text-lco-teal" : "text-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {b.name}
                      {b.has_type && b.branch_type === "pusat" && (
                        <span className="ml-1.5 text-[11px] font-normal text-zinc-400">Pusat</span>
                      )}
                    </span>
                    {b.address && (
                      <span className="block truncate text-[11px] font-normal text-zinc-400">{b.address}</span>
                    )}
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
