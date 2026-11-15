/**
 * Nama schema Postgres tempat tabel & RPC aplikasi ini berada.
 * Harus sama dengan schema di schema_e_pos.sql dan terdaftar di
 * PGRST_DB_SCHEMAS pada Supabase self-hosted.
 */
export const DB_SCHEMA = "e_pos";

/**
 * Domain cookie login. Semua unit usaha (konveksi, sablon, pos, dst.) memakai
 * SATU Supabase dan SATU cookie login lintas subdomain. Harus sama di semua unit.
 * Diambil saat build (NEXT_PUBLIC_*), bawaannya sudah ".langitan.co".
 */
export const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || ".langitan.co";

/**
 * Opsi cookie sesi login. HARUS identik di browser client, middleware.ts,
 * dan semua unit lain (lihat lib/config.ts di aplikasi konveksi). Kalau beda,
 * browser menyimpan DUA cookie bernama sama (satu host-only, satu lintas
 * subdomain) dengan token berbeda, dan token yang usang ditolak server auth
 * dengan "Invalid Refresh Token: Refresh Token Not Found".
 *
 * Saat development (localhost) domain & secure dimatikan, kalau tidak browser
 * menolak cookie dan login tidak pernah berhasil di komputer sendiri.
 */
export function authCookieOptions() {
  if (process.env.NODE_ENV !== "production") return undefined;
  return {
    domain: COOKIE_DOMAIN,
    path: "/",
    sameSite: "lax" as const,
    secure: true,
  };
}
