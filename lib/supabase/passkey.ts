// lib/supabase/passkey.ts
// ── TAMBAHAN (login passkey) ── Pembungkus tipis untuk API passkey Supabase
// Auth (supabase.auth.registerPasskey / signInWithPasskey / passkey.*).
//
// Passkey = login dengan verifikasi biometrik atau kunci layar PERANGKAT:
// sidik jari di HP Android, Face ID/Touch ID di iPhone/Mac, Windows Hello di
// laptop. Aplikasi tidak pernah menerima data sidik jari/wajah — hanya bukti
// kriptografi dari perangkat. Perangkat mana pun yang didukung otomatis
// memakai metode yang dia punya.
//
// Antarmuka lokal (PasskeyAuthApi) sengaja dipakai alih-alih tipe bawaan
// supabase-js: API ini masih beta dan bentuk tipenya bisa bergeser antar
// versi minor, sementara yang dipakai aplikasi cuma 5 operasi di bawah. Bentuk
// datanya mengikuti dokumentasi Supabase (Auth > Passkeys).
//
// Syarat server: passkey harus diaktifkan di Supabase Auth (lihat bagian
// "Login sidik jari / passkey" di README.md) dan situs diakses lewat HTTPS.

import { createClient } from "./client";

export interface PasskeyRow {
  id: string;
  friendly_name: string | null;
  created_at: string;
  last_used_at?: string | null;
}

interface AuthResult<T> {
  data: T | null;
  error: unknown;
}

interface PasskeyAuthApi {
  registerPasskey: () => Promise<AuthResult<{ id: string }>>;
  signInWithPasskey: () => Promise<AuthResult<unknown>>;
  passkey: {
    list: () => Promise<AuthResult<PasskeyRow[]>>;
    update: (args: { passkeyId: string; friendlyName: string }) => Promise<AuthResult<unknown>>;
    delete: (args: { passkeyId: string }) => Promise<AuthResult<unknown>>;
  };
}

function authApi(): PasskeyAuthApi {
  return createClient().auth as unknown as PasskeyAuthApi;
}

/** true kalau browser punya API WebAuthn. Hanya boleh dipanggil di browser (useEffect / handler). */
export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

/** Login dengan passkey. Berhasil → sesi terbentuk dan SIGNED_IN dikirim ke useAuth. Gagal → lempar error. */
export async function signInWithPasskey(): Promise<void> {
  const { error } = await authApi().signInWithPasskey();
  if (error) throw error;
}

/** Daftarkan passkey untuk user yang SEDANG login. Mengembalikan id passkey baru. */
export async function registerPasskey(friendlyName: string): Promise<string> {
  const { data, error } = await authApi().registerPasskey();
  if (error || !data) throw error ?? new Error("registerPasskey tidak mengembalikan data");
  // Nama bawaan itu kosmetik (supaya daftar passkey mudah dikenali); kalau
  // gagal disimpan, passkey-nya sendiri tetap sah dan tidak perlu dibatalkan.
  try {
    await authApi().passkey.update({ passkeyId: data.id, friendlyName });
  } catch {
    // diabaikan
  }
  return data.id;
}

export async function listPasskeys(): Promise<PasskeyRow[]> {
  const { data, error } = await authApi().passkey.list();
  if (error) throw error;
  return data ?? [];
}

export async function deletePasskey(passkeyId: string): Promise<void> {
  const { error } = await authApi().passkey.delete({ passkeyId });
  if (error) throw error;
}
