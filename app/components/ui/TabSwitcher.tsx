"use client";

// ── TAMBAHAN (komponen UI bersama) ── Tab switcher gaya "segmented control"
// (kontainer abu-abu membulat, tab aktif putih + bayangan tipis). Sebelumnya
// markup yang sama disalin ke 7 tempat dengan variasi kecil (ada yang huruf
// kapital, ada yang tidak). Sekarang semua memakai komponen ini.
//
// Cara pakai:
//   <TabSwitcher
//     tabs={[
//       { key: "produk", label: "Produk", icon: Package },
//       { key: "kategori", label: "Kategori" },
//     ]}
//     value={activeTab}
//     onChange={setActiveTab}
//     className="mb-4"
//   />
//
// Props:
//   tabs       daftar tab; `icon` opsional (komponen ikon lucide-react).
//   value      key tab yang aktif.
//   onChange   dipanggil dengan key tab yang diklik.
//   size       "md" (default) untuk tab halaman, "sm" untuk filter ringkas
//              (mis. periode).
//   fullWidth  true -> kontainer selebar induk dan tiap tab dibagi rata.
//   className  untuk margin/posisi saja (mis. "mb-4").

import type { ComponentType } from "react";

export interface TabItem<T extends string> {
  key: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

interface TabSwitcherProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
  ariaLabel?: string;
}

const SIZE_CLASS = {
  md: "px-3.5 py-2",
  sm: "px-3 py-1.5",
} as const;

export default function TabSwitcher<T extends string>({
  tabs,
  value,
  onChange,
  size = "md",
  fullWidth = false,
  className = "",
  ariaLabel,
}: TabSwitcherProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${
        fullWidth ? "flex w-full" : "inline-flex w-fit flex-wrap"
      } gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900 ${className}`.trim()}
    >
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = value === key;

        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={`flex items-center justify-center gap-2 rounded-lg ${
              SIZE_CLASS[size]
            } text-sm font-medium transition-colors duration-150 ${
              fullWidth ? "flex-1" : ""
            } ${
              isActive
                ? "bg-white text-lco-green shadow-sm dark:bg-zinc-800 dark:text-lco-teal"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
