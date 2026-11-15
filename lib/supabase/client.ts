import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DB_SCHEMA, authCookieOptions } from "./config";

/**
 * ── KOREKSI (bug: "selalu rendering" / risiko rate limit auth) ──
 * Sebelumnya `createClient()` memanggil `createBrowserClient()` BARU setiap
 * kali fungsi ini dipanggil. Karena hampir tiap hook (useAuth, useProducts,
 * useSettings, useDashboard, useStock, useReports, useShifts,
 * useTransactions, dll — total belasan file) punya baris
 * `const supabase = createClient();` di scope modulnya sendiri, efeknya
 * aplikasi ini diam-diam menjalankan BELASAN instance GoTrueClient (klien
 * auth Supabase) sekaligus di satu tab browser.
 *
 * Tiap instance auth itu punya timer auto-refresh token sendiri-sendiri,
 * jadi token sesi yang SAMA di-refresh berkali-kali secara paralel oleh
 * instance-instance yang berbeda — ini persis kondisi yang memicu warning
 * Supabase "Multiple GoTrueClient instances detected in the same browser
 * context", dan kalau terus terjadi (apalagi kasir sering pindah menu,
 * yang bikin modul unmount/mount ulang → instance baru lagi) bisa betulan
 * kena rate limit endpoint auth Supabase.
 *
 * Perbaikan: cache SATU instance di scope modul ini (`cachedClient`).
 * Panggilan `createClient()` keberapa pun, di file manapun, sekarang selalu
 * mengembalikan objek client yang SAMA — persis pola singleton yang
 * direkomendasikan resminya oleh @supabase/ssr untuk Client Component.
 */
let cachedClient: SupabaseClient | undefined;

/**
 * ── TAMBAHAN (perbaikan "Refresh Token Not Found" di perangkat lain) ──
 * Sebelum cookie login memakai domain lintas subdomain, e-pos menyimpannya
 * sebagai cookie host-only (hanya pos.langitan.co). Cookie lama itu masih
 * tertinggal di browser dan kini bertabrakan dengan cookie lintas subdomain
 * yang namanya sama. Menghapus cookie TANPA atribut Domain hanya mengenai
 * cookie host-only, jadi cookie lintas subdomain (login unit lain) aman.
 * Konsekuensi: perangkat yang masih memakai cookie lama harus login sekali lagi.
 */
function removeLegacyHostOnlyAuthCookies(): void {
  if (typeof document === "undefined" || !authCookieOptions()) return;
  try {
    const names = new Set(
      document.cookie
        .split(";")
        .map((c) => c.split("=")[0].trim())
        .filter((n) => /^sb-.+-auth-token(\.\d+)?$/.test(n)),
    );
    names.forEach((name) => {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    });
  } catch {
    // cookie tidak bisa diakses — abaikan
  }
}

/**
 * Client Supabase untuk dipakai di Client Component ("use client").
 * Baca env NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY —
 * pastikan dua ini ada di .env.local (lihat catatan di bawah).
 */
export function createClient(): SupabaseClient {
  if (!cachedClient) {
    removeLegacyHostOnlyAuthCookies();
    cachedClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: DB_SCHEMA }, cookieOptions: authCookieOptions() },
    ) as unknown as SupabaseClient;
  }
  return cachedClient;
}