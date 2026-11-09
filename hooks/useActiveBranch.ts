// hooks/useActiveBranch.ts
// ── BARU (migration 047, multi cabang) ── Cabang yang sedang dipilih di
// perangkat ini + daftar cabang yang boleh diakses user login.
//
// Dibuat sebagai store modul (bukan React context) karena hook lain di app ini
// juga tidak memakai provider — semua komponen (Header, Kasir, Laporan, dst.)
// membaca satu sumber yang sama lewat `useSyncExternalStore`.
//
// Daftar cabang SUDAH tersaring oleh RLS (`can_access_branch`): user yang
// dibatasi hanya menerima cabang miliknya, jadi tidak ada logika filter akses
// di sisi client — client cuma menampilkan apa yang database izinkan.
//
// Cara pakai di hook data:
//   const { branchId, ready } = useBranchScope();
//   // tunggu ready, lalu tambahkan .eq("branch_id", branchId) kalau branchId != null.
//   // branchId == null (+ ready) = belum ada cabang sama sekali -> jangan filter.

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVE_BRANCH_STORAGE_KEY,
  normalizeBranch,
  resolveActiveBranchId,
  type Branch,
} from "@/lib/pos/branches";
import { selectBranchRows } from "@/lib/pos/branchQuery";

const supabase = createClient();

interface BranchState {
  /** Hanya cabang yang boleh diakses user login (sudah disaring RLS). */
  branches: Branch[];
  activeId: string | null;
  loaded: boolean;
  error: string | null;
}

const SERVER_STATE: BranchState = { branches: [], activeId: null, loaded: false, error: null };

let state: BranchState = SERVER_STATE;
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;
let authWatching = false;

function emit(next: BranchState) {
  state = next;
  listeners.forEach((l) => l());
}

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_BRANCH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ACTIVE_BRANCH_STORAGE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_BRANCH_STORAGE_KEY);
  } catch {
    // localStorage diblokir (mode privat dsb.) — pilihan cukup hidup di memori.
  }
}

async function fetchBranches(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    // Belum login: jangan tandai loaded, nanti dimuat ulang saat login.
    emit({ ...state, branches: [], activeId: null, loaded: false, error: null });
    return;
  }

  // Migration 053/048 yang belum dijalankan ditangani selectBranchRows (kolom cadangan).
  const { rows, errorMessage } = await selectBranchRows(supabase);

  if (errorMessage) {
    // Paling sering: migration 047 belum dijalankan -> app tetap jalan tanpa mode cabang.
    emit({ branches: [], activeId: null, loaded: true, error: errorMessage });
    return;
  }

  const branches: Branch[] = rows.map(normalizeBranch);
  const activeId = resolveActiveBranchId(branches, state.activeId ?? readStoredId());
  writeStoredId(activeId);
  emit({ branches, activeId, loaded: true, error: null });
}

function watchAuthOnce() {
  if (authWatching || typeof window === "undefined") return;
  authWatching = true;
  supabase.auth.onAuthStateChange((event) => {
    // Ganti akun / logout: buang daftar lama supaya tidak bocor ke user berikutnya.
    if (event === "SIGNED_OUT") {
      loadPromise = null;
      emit({ branches: [], activeId: null, loaded: false, error: null });
    } else if (event === "SIGNED_IN") {
      loadPromise = null;
      emit({ ...state, loaded: false });
      ensureLoaded();
    }
  });
}

function ensureLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  watchAuthOnce();
  if (!loadPromise) {
    loadPromise = fetchBranches().finally(() => {
      // Boleh dimuat ulang kalau belum loaded (mis. belum login).
      if (!state.loaded) loadPromise = null;
    });
  }
  return loadPromise;
}

/** Muat ulang daftar cabang (dipanggil setelah tambah/ubah cabang). */
export function reloadBranches(): Promise<void> {
  loadPromise = null;
  return ensureLoaded();
}

function setActiveBranchId(id: string) {
  if (!state.branches.some((b) => b.id === id && b.is_active)) return;
  writeStoredId(id);
  emit({ ...state, activeId: id });
}

/** Pembacaan sekali (non-hook) — untuk kode di luar komponen React. */
export function getActiveBranchId(): string | null {
  return state.activeId;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => SERVER_STATE;

export function useActiveBranch() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setActiveBranch = useCallback((id: string) => setActiveBranchId(id), []);
  const activeBranch = snap.branches.find((b) => b.id === snap.activeId) ?? null;
  return {
    branches: snap.branches,
    activeBranch,
    activeBranchId: snap.activeId,
    isLoading: !snap.loaded,
    error: snap.error,
    setActiveBranch,
    reload: reloadBranches,
  };
}

/**
 * Untuk hook data: cabang yang harus dipakai sebagai filter.
 * `ready` false = daftar cabang belum selesai dimuat (tunda query supaya tidak
 * sempat menarik data semua cabang lalu di-refetch).
 */
export function useBranchScope(): { branchId: string | null; ready: boolean } {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { branchId: snap.activeId, ready: snap.loaded };
}
