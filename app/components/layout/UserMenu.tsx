"use client";

// ── BARU (profil user pindah ke Header) ── Sebelumnya identitas user + tombol
// Keluar ada di footer Sidebar. Sekarang Sidebar cuma berisi menu, dan profil
// user tampil di kanan Header: avatar inisial + nama + role, klik untuk buka
// dropdown berisi detail akun dan tombol Keluar.
//
// Logika keluar (signOut → hapus menu tersimpan → reload penuh ke /login)
// dipindah apa adanya dari Sidebar.tsx. Reload penuh (bukan router.push)
// sengaja dipertahankan supaya semua state di memori — keranjang, data shift,
// cache hook — hilang dan tidak bocor ke user berikutnya di tablet kasir yang
// dipakai bergantian.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { clearStoredMenu } from "@/lib/pos/activeMenu";

/** Inisial maksimal 2 huruf dari nama (mis. "MTs Al Falahiyah" → "MA"). */
function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase();
}

const avatarClass =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lco-green/10 text-xs font-semibold text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal";

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Tutup dropdown saat klik di luar atau tekan Escape (pola sama dengan
  // BranchSwitcher.tsx).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      // Hapus menu terakhir yang disimpan, supaya login berikutnya mulai dari Dashboard.
      clearStoredMenu();
      window.location.assign("/login");
    } catch {
      setSignOutError("Gagal keluar. Periksa koneksi lalu coba lagi.");
      setIsSigningOut(false);
    }
  }

  // Selagi profil user dimuat: placeholder avatar supaya header tidak bergeser.
  if (!user) {
    return (
      <span
        aria-hidden="true"
        className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
      />
    );
  }

  const displayName = user.full_name || user.email || "Pengguna";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Akun"
        className="flex items-center gap-2.5 rounded-lg p-1 transition-colors duration-150 hover:bg-zinc-100 dark:hover:bg-zinc-900 md:pr-2"
      >
        <span className={avatarClass}>{getInitials(displayName)}</span>
        <span className="hidden min-w-0 text-left md:block">
          <span className="block max-w-[160px] truncate text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
            {displayName}
          </span>
          <span className="block max-w-[160px] truncate text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
            {user.role_label}
          </span>
        </span>
        <ChevronDown
          className={`hidden h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150 md:block ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu akun"
          className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
            <span className={avatarClass}>{getInitials(displayName)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {displayName}
              </p>
              {user.email && user.email !== displayName && (
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {user.email}
                </p>
              )}
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                {user.role_label}
              </p>
            </div>
          </div>

          <div className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isSigningOut ? "Keluar..." : "Keluar"}
            </button>
            {signOutError && (
              <p className="px-3 pb-1 pt-1 text-[11px] leading-snug text-lco-coral">
                {signOutError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
