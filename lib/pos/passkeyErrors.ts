// lib/pos/passkeyErrors.ts
// ── TAMBAHAN (login passkey) ── Menerjemahkan error dari alur passkey/WebAuthn
// jadi pesan Bahasa Indonesia yang bisa dipahami kasir. Fungsi murni (tanpa
// DOM/Supabase) supaya bisa dites di vitest environment "node".
//
// Sumber error ada tiga dan bentuknya beda-beda, jadi pengecekan sengaja
// longgar (name + code + message + cause):
//   1. Browser (DOMException): NotAllowedError (dibatalkan/timeout),
//      InvalidStateError (perangkat sudah terdaftar), SecurityError (domain
//      tidak cocok dengan RP ID), NotSupportedError.
//   2. Pembungkus WebAuthn di supabase-js: membawa `code`/`cause`.
//   3. Server Supabase Auth: `code` seperti passkey_disabled, too_many_passkeys.

export type PasskeyAction = "login" | "register";

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Kumpulkan semua petunjuk (name/code/message) dari error dan cause-nya jadi satu teks huruf kecil. */
function collectHints(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  // Batasi kedalaman supaya cause yang melingkar tidak membuat loop tak berhenti.
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const e = current as ErrorLike;
    parts.push(str(e.name), str(e.code), str(e.message));
    current = e.cause;
  }
  return parts.join(" ").toLowerCase();
}

export function describePasskeyError(err: unknown, action: PasskeyAction): string {
  const hints = collectHints(err);

  if (hints.includes("passkey_disabled")) {
    return "Fitur passkey belum diaktifkan di server. Hubungi admin.";
  }
  if (hints.includes("too_many_passkeys")) {
    return "Jumlah passkey sudah mencapai batas. Hapus yang tidak dipakai, lalu coba lagi.";
  }
  if (
    hints.includes("invalidstateerror") ||
    hints.includes("previously_registered") ||
    hints.includes("previously registered")
  ) {
    return "Perangkat ini sudah terdaftar untuk akun kamu.";
  }
  if (hints.includes("securityerror") || hints.includes("rp id") || hints.includes("rpid")) {
    return "Alamat aplikasi tidak cocok dengan pengaturan passkey di server. Hubungi admin.";
  }
  if (hints.includes("notsupportederror") || hints.includes("not supported")) {
    return "Perangkat atau browser ini belum mendukung passkey.";
  }
  // Dibatalkan pengguna / layar verifikasi ditutup / waktu habis.
  if (
    hints.includes("notallowederror") ||
    hints.includes("aborterror") ||
    hints.includes("ceremony_aborted") ||
    hints.includes("cancel")
  ) {
    return action === "login"
      ? "Verifikasi dibatalkan. Coba lagi, atau masuk dengan email & password."
      : "Pendaftaran dibatalkan. Coba lagi kalau mau menambahkan.";
  }
  if (hints.includes("failed to fetch") || hints.includes("network")) {
    return "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.";
  }

  return action === "login"
    ? "Masuk dengan passkey gagal. Pastikan sidik jari sudah didaftarkan di perangkat ini, atau masuk dengan email & password."
    : "Gagal mendaftarkan passkey. Coba lagi.";
}

/** Nama perangkat singkat dari user-agent, dipakai sebagai nama bawaan passkey yang baru didaftarkan. */
export function guessDeviceName(userAgent: string, now: Date = new Date()): string {
  const ua = userAgent.toLowerCase();
  let device = "Perangkat";
  if (ua.includes("iphone")) device = "iPhone";
  else if (ua.includes("ipad")) device = "iPad";
  else if (ua.includes("android")) device = "HP/Tablet Android";
  else if (ua.includes("windows")) device = "Windows";
  else if (ua.includes("mac os")) device = "Mac";
  else if (ua.includes("linux")) device = "Linux";

  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${device} (${day}/${month}/${now.getFullYear()})`;
}
