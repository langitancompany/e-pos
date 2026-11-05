"use client";

// ── TAMBAHAN (header/topbar) ── Topbar di atas konten utama, tampil di semua
// modul (Dashboard, dst.) — penanda "sedang di menu apa" di area konten itu
// sendiri. Berguna terutama di mobile: sidebar di sana jadi drawer
// tersembunyi (lihat Sidebar.tsx), jadi tanpa header ini kasir tidak punya
// cara melihat nama menu aktif tanpa buka drawer dulu.
//
// Sengaja "dumb" seperti Sidebar: cuma menerima `activeMenu` dari page.tsx,
// tidak simpan state sendiri. Judul diambil dari `MENU_GROUPS` yang di-export
// Sidebar.tsx (satu sumber kebenaran) — kalau ada menu baru ditambah di sana,
// Header ini otomatis ikut tanpa perlu disentuh.
//
// ── PERUBAHAN (rapikan header & sidebar) ──
// - Kiri: judul menu berupa teks saja. Kotak ikon dan label grup dihapus.
// - Kanan (kiri ke kanan): tombol tema, pemilih cabang, Buka Kasir, profil user.
//   Tombol tema dan profil/Keluar sebelumnya ada di footer Sidebar.

import { Moon, ShoppingCart, Sun } from "lucide-react";
import { MENU_GROUPS } from "./Sidebar";
import UserMenu from "./UserMenu";
import IconButton from "@/app/components/ui/IconButton";
import { useSettings } from "@/hooks/useSettings";
// Preferensi tema PER-DEVICE (localStorage), bukan pengaturan toko — lihat
// catatan lengkap di hooks/useThemePreference.ts. Semua role boleh mengubahnya.
import { useThemePreference } from "@/hooks/useThemePreference";
// ── TAMBAHAN (migration 047, multi cabang) ── Pemilih cabang di kiri tombol Buka Kasir.
import BranchSwitcher from "../branch/BranchSwitcher";

interface HeaderProps {
  activeMenu: string;
  // ── TAMBAHAN (Kasir full-screen, tombol "Buka Kasir" di header) ── Kasir
  // tidak lagi ada di Sidebar (lihat catatan MENU_GROUPS di Sidebar.tsx) —
  // ini salah satu dari 2 jalan masuk satu-satunya (yang lain: DashboardModule).
  onOpenKasir: () => void;
}

// ── TAMBAHAN ── Keterangan singkat di bawah judul menu (opsional per menu).
// Menu yang tidak terdaftar di sini tampil seperti biasa tanpa keterangan.
const MENU_DESCRIPTIONS: Record<string, string> = {
  outlet:
    "Atur informasi toko, pajak, poin member, dan struk untuk setiap cabang.",
  "label-barcode":
    "Cetak label barcode / QR untuk ditempel di produk, supaya kasir tinggal scan.",
};

/** Cari label menu aktif dari MENU_GROUPS. */
function findMenuLabel(key: string) {
  for (const group of MENU_GROUPS) {
    const item = group.items.find((menuItem) => menuItem.key === key);
    if (item) return item.label;
  }
  // Fallback aman: kalau `key` somehow tidak ada di MENU_GROUPS (mis. menu
  // baru ditambah di page.tsx tapi belum didaftarkan di Sidebar), header
  // tetap tampil (judul generik) daripada crash.
  return null;
}

function ThemeToggle() {
  const { theme, toggleTheme } = useThemePreference();
  const isDark = theme === "dark";

  return (
    <IconButton
      type="button"
      onClick={toggleTheme}
      variant="soft"
      size="lg"
      aria-label={isDark ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
      title={isDark ? "Mode terang" : "Mode gelap"}
    >
      {isDark ? (
        <Sun className="h-4.5 w-4.5" />
      ) : (
        <Moon className="h-4.5 w-4.5" />
      )}
    </IconButton>
  );
}

export default function Header({ activeMenu, onOpenKasir }: HeaderProps) {
  // Nama toko dari Pengaturan > Toko (hooks/useSettings.ts) — pakai fallback
  // DEFAULT_SETTINGS bawaan hook selagi loading, jadi tidak pernah tampil
  // kosong/kedip di kanan header.
  const { settings } = useSettings();
  const title = findMenuLabel(activeMenu) ?? "LCO POS";

  return (
    // ── CATATAN ── Tinggi `h-17` di sini SENGAJA sama dengan blok judul "LCO POS"
    // di Sidebar.tsx supaya garis bawah keduanya lurus — ubah keduanya bersamaan.
    <header className="sticky top-0 z-10 flex h-17 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white pl-16 pr-4 dark:border-zinc-800 dark:bg-zinc-950 md:pl-6">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100 md:text-base">
          {title}
        </h2>
        {MENU_DESCRIPTIONS[activeMenu] && (
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {MENU_DESCRIPTIONS[activeMenu]}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        {/* ── PERUBAHAN (migration 047) ── Badge nama toko statis diganti pemilih
            cabang. Tetap tampil sebagai badge biasa kalau cuma ada satu cabang.
            Disembunyikan di layar paling sempit (lihat BranchSwitcher.tsx). */}
        <BranchSwitcher fallbackName={settings.namaToko} />
        {/* ── TAMBAHAN (Kasir full-screen) ── Jalan masuk ke Kasir dari mana
            saja — begitu diklik, page.tsx pindah activeMenu="kasir" dan
            me-render KasirModule TANPA Sidebar/Header ini (full-screen).
            Di bawah `sm` tinggal ikon supaya judul menu & profil tetap muat. */}
        <button
          type="button"
          onClick={onOpenKasir}
          aria-label="Buka Kasir"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-lco-green px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-lco-green-hover"
        >
          <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Buka Kasir</span>
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
