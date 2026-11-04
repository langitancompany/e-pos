-- Migration 049: Hapus cabang (outlet) yang BELUM punya riwayat.
--
-- Target schema: e_pos (sama dengan lib/supabase/config.ts). Aman dijalankan ulang.
--
-- Aturan (sengaja ketat — data transaksi merujuk ke cabang):
--   1. Pemanggil harus punya izin pengaturan_toko.delete (Super Admin selalu boleh)
--      dan boleh mengakses cabang tsb (can_access_branch).
--   2. Cabang yang sudah punya shift, transaksi, catatan kas, atau pesanan
--      ditahan TIDAK bisa dihapus -> pakai "Nonaktifkan outlet".
--   3. Cabang terakhir tidak bisa dihapus.
--   4. Kalau ada user yang HANYA dibatasi ke cabang ini, penghapusan ditolak.
--      Alasan: batasan cabang kosong ({}) berarti "boleh SEMUA cabang", jadi
--      membuang cabang itu diam-diam akan melebarkan akses user tersebut.
--   5. User yang dibatasi ke beberapa cabang: cabang ini dibuang dari daftarnya.
--   6. Dicatat di activity_logs (action 'branch_delete').

set search_path = e_pos, public;

create or replace function e_pos.delete_branch(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $function$
declare
  v_branch   record;
  v_active   integer;
  v_blocker  text;
  v_n        bigint;
begin
  if not e_pos.has_permission_action('pengaturan_toko', 'delete') then
    raise exception 'Anda tidak punya izin untuk menghapus outlet';
  end if;

  select id, name, code, is_active into v_branch
  from e_pos.branches
  where id = p_branch_id
  for update;

  if not found then
    raise exception 'Outlet tidak ditemukan';
  end if;

  if not e_pos.can_access_branch(p_branch_id) then
    raise exception 'Anda tidak punya akses ke outlet ini';
  end if;

  if (select count(*) from e_pos.branches) <= 1 then
    raise exception 'Outlet terakhir tidak bisa dihapus';
  end if;

  if v_branch.is_active then
    select count(*) into v_active from e_pos.branches where is_active = true;
    if v_active <= 1 then
      raise exception 'Minimal harus ada satu outlet aktif';
    end if;
  end if;

  -- Riwayat yang merujuk ke cabang ini.
  select count(*) into v_n from e_pos.shift_sessions where branch_id = p_branch_id;
  if v_n > 0 then v_blocker := format('%s shift', v_n); end if;

  if v_blocker is null then
    select count(*) into v_n from e_pos.transactions where branch_id = p_branch_id;
    if v_n > 0 then v_blocker := format('%s transaksi', v_n); end if;
  end if;

  if v_blocker is null then
    select count(*) into v_n from e_pos.cash_movements where branch_id = p_branch_id;
    if v_n > 0 then v_blocker := format('%s catatan kas', v_n); end if;
  end if;

  if v_blocker is null then
    select count(*) into v_n from e_pos.held_orders where branch_id = p_branch_id;
    if v_n > 0 then v_blocker := format('%s pesanan ditahan', v_n); end if;
  end if;

  if v_blocker is not null then
    raise exception 'Outlet ini sudah punya riwayat (%) sehingga tidak bisa dihapus. Nonaktifkan saja.', v_blocker;
  end if;

  -- User yang hanya dibatasi ke cabang ini (membuang cabangnya = akses semua cabang).
  select count(*) into v_n
  from e_pos.profiles
  where branch_ids = array[p_branch_id]::uuid[];
  if v_n > 0 then
    raise exception 'Ada % user yang hanya dibatasi ke outlet ini. Ubah batasan cabang user tersebut dulu.', v_n;
  end if;

  update e_pos.profiles
  set branch_ids = array_remove(branch_ids, p_branch_id)
  where p_branch_id = any(branch_ids);

  delete from e_pos.branches where id = p_branch_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'branch_delete', 'branch', p_branch_id,
    jsonb_build_object('branch_name', v_branch.name, 'branch_code', v_branch.code)
  );

  return jsonb_build_object('success', true, 'branch_id', p_branch_id);
end;
$function$;

comment on function e_pos.delete_branch(uuid) is
  'Hapus permanen cabang yang belum punya riwayat (shift/transaksi/kas/pesanan ditahan). Migration 049.';

revoke all on function e_pos.delete_branch(uuid) from public;
grant execute on function e_pos.delete_branch(uuid) to authenticated, service_role;

comment on table e_pos.branches is
  'Daftar cabang/toko. Migration 047. Cabang yang sudah punya riwayat tidak bisa dihapus (nonaktifkan saja); cabang kosong bisa dihapus lewat delete_branch() (migration 049).';
