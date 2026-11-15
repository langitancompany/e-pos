// app/api/admin/delete-user/route.ts
//
// Endpoint server-side "Hapus User" di Pengaturan > Pengguna.
//
//   DELETE { id }
//
// KENAPA HARUS API ROUTE: menghapus akun login = Supabase Admin API
// (auth.admin.deleteUser) dengan SUPABASE_SERVICE_ROLE_KEY. Route ini SENDIRI
// yang wajib memvalidasi pemanggil sebelum memakai kunci itu.
//
// Aturan:
//   1. Pemanggil harus punya izin pengaturan_admin.delete (atau Super Admin).
//   2. Tidak bisa menghapus akun sendiri.
//   3. Hanya Super Admin yang boleh menghapus akun Super Admin, dan Super Admin
//      aktif terakhir tidak bisa dihapus.
//   4. HANYA user yang belum punya riwayat yang boleh dihapus permanen. Tabel
//      transaksi, shift, pembayaran digital, mutasi stok, dan log aktivitas
//      merujuk ke profil user; shift_sessions bahkan ON DELETE CASCADE, jadi
//      menghapus user yang pernah bekerja akan ikut melenyapkan data shift.
//      Untuk user seperti itu pesan error menyarankan "Nonaktifkan".
//   5. Urutan: hapus baris profiles dulu (tidak ada FK profiles -> auth.users di
//      schema e_pos), baru akun login. Pesanan ditahan (held_orders) milik user
//      ikut terhapus lewat ON DELETE CASCADE — itu keranjang sementara.
//   6. Dicatat di activity_logs (action 'user_delete').

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdminCaller, fail } from "@/lib/supabase/adminApi";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tabel yang menyimpan riwayat milik user: [tabel, kolom user, label untuk pesan]. */
const HISTORY_CHECKS: [string, string, string][] = [
  ["transactions", "cashier_id", "transaksi"],
  ["shift_sessions", "cashier_id", "shift kasir"],
  ["digital_payments", "cashier_id", "pembayaran digital"],
  ["stock_movements", "created_by", "mutasi stok"],
  ["activity_logs", "user_id", "log aktivitas"],
  ["promo_screens", "created_by", "layar promo"],
];

/** Mengembalikan label riwayat pertama yang ditemukan (+ jumlahnya), atau null bila bersih. */
async function findHistory(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<{ label: string; count: number } | { error: string } | null> {
  for (const [table, column, label] of HISTORY_CHECKS) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, userId);
    if (error) {
      return { error: `Gagal memeriksa riwayat user (${table}): ${error.message}` };
    }
    if ((count ?? 0) > 0) return { label, count: count ?? 0 };
  }
  return null;
}

export async function DELETE(request: NextRequest) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return fail("Body request tidak valid (bukan JSON).", 400);
  }

  const id = (body.id ?? "").trim();
  if (!id || !UUID_RE.test(id)) return fail("id user tidak valid.", 400);

  const auth = await authorizeAdminCaller(request, "delete");
  if ("response" in auth) return auth.response;
  const { callerId, callerIsSuperAdmin, supabaseAdmin } = auth;

  if (id === callerId) return fail("Anda tidak bisa menghapus akun Anda sendiri.", 403);

  const { data: target } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, roles, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!target) return fail("User tidak ditemukan.", 404);

  const targetRoles: string[] = Array.isArray(target.roles) ? target.roles : [];
  const targetIsSuper = targetRoles.includes("super_admin");

  if (targetIsSuper) {
    if (!callerIsSuperAdmin) {
      return fail("Hanya Super Admin yang boleh menghapus akun Super Admin.", 403);
    }
    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .neq("id", id)
      .eq("is_active", true)
      .contains("roles", ["super_admin"]);
    if ((count ?? 0) === 0) return fail("Tidak bisa menghapus Super Admin terakhir.", 409);
  }

  const history = await findHistory(supabaseAdmin, id);
  if (history && "error" in history) return fail(history.error, 500);
  if (history) {
    return fail(
      `${target.full_name ?? "User ini"} sudah punya riwayat (${history.count} ${history.label}) sehingga tidak bisa dihapus permanen. Gunakan Nonaktifkan supaya data transaksi tetap utuh.`,
      409,
    );
  }

  const { error: profileDeleteError } = await supabaseAdmin.from("profiles").delete().eq("id", id);
  if (profileDeleteError) {
    const isFk = profileDeleteError.code === "23503";
    return fail(
      isFk
        ? `${target.full_name ?? "User ini"} masih dipakai data lain sehingga tidak bisa dihapus. Gunakan Nonaktifkan.`
        : profileDeleteError.message || "Gagal menghapus user.",
      isFk ? 409 : 500,
    );
  }

  const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(id);
  const authAlreadyGone = !!authDeleteError && /not.?found/i.test(authDeleteError.message ?? "");
  if (authDeleteError && !authAlreadyGone) {
    // Profil sudah terhapus, jadi akun ini tidak bisa masuk aplikasi lagi
    // ("profil tidak ditemukan"). Sisa akun login bisa dibersihkan dari Supabase Dashboard.
    return fail(
      `Data user terhapus, tetapi akun login gagal dihapus: ${authDeleteError.message}. Hapus akun ${target.email ?? id} manual di Supabase Dashboard > Authentication.`,
      500,
    );
  }

  await supabaseAdmin.from("activity_logs").insert({
    user_id: callerId,
    action: "user_delete",
    entity: "user",
    entity_id: id,
    meta: { target_name: target.full_name, email: target.email, roles: targetRoles },
  });

  return NextResponse.json({ success: true });
}
