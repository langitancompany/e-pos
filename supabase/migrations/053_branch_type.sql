-- Migration 053: Jenis outlet (pusat atau cabang)
--
-- Target schema: e_pos. WAJIB setelah 047, 048, dan 052. Aman dijalankan ulang.
-- Satu transaksi: kalau ada langkah gagal, tidak ada yang berubah.
--
-- Aturan yang ditegakkan di database:
--   1. Setiap outlet berjenis 'pusat' atau 'cabang'. Hanya boleh ada SATU pusat.
--   2. Outlet pertama (sort_order terkecil) otomatis jadi pusat saat migration
--      pertama kali jalan, karena stok lama memang sudah dipindah ke outlet itu
--      oleh migration 052.
--   3. Outlet pusat tidak bisa dinonaktifkan atau dihapus selama masih pusat.
--      Ubah jenisnya jadi cabang dulu (dan jadikan outlet lain sebagai pusat).
--
-- Produk yang dibuat di cabang hanya terpasang di cabang itu (tidak muncul di pusat),
-- dan produk dari pusat baru muncul di cabang setelah dipasang lewat
-- assign_product_branch. Pengguna yang dibatasi ke cabang tidak bisa memasang produk
-- ke pusat karena resolve_branch menolak outlet yang tidak boleh ia akses.

begin;

set local search_path = e_pos, public;

do $$
begin
  if to_regclass('e_pos.branches') is null then
    raise exception 'Jalankan migration 047_multi_branch.sql terlebih dulu.';
  end if;
  if to_regclass('e_pos.product_branches') is null then
    raise exception 'Jalankan migration 052_branch_inventory.sql terlebih dulu.';
  end if;
end $$;

-- 1. Kolom jenis outlet. Outlet pertama jadi pusat hanya pada eksekusi pertama,
--    supaya menjalankan ulang migration tidak mengembalikan pusat yang sengaja diubah.

do $$
declare
  v_first_run boolean;
begin
  select not exists (
    select 1 from information_schema.columns
     where table_schema = 'e_pos' and table_name = 'branches' and column_name = 'branch_type'
  ) into v_first_run;

  alter table e_pos.branches
    add column if not exists branch_type text not null default 'cabang';

  alter table e_pos.branches drop constraint if exists branches_branch_type_check;
  alter table e_pos.branches
    add constraint branches_branch_type_check check (branch_type in ('pusat', 'cabang'));

  if v_first_run then
    update e_pos.branches
       set branch_type = 'pusat'
     where id = (select id from e_pos.branches order by sort_order, created_at limit 1);
  end if;
end $$;

create unique index if not exists branches_single_pusat_idx
  on e_pos.branches ((true)) where branch_type = 'pusat';

comment on column e_pos.branches.branch_type is
  'pusat = pemegang katalog produk (produk baru hanya dibuat dari sini), cabang = menjual produk yang dipasang dari pusat. Maksimal satu pusat. Migration 053.';

-- 2. Fungsi bantu

create or replace function e_pos.pusat_branch_id()
returns uuid
language sql
stable
security definer
set search_path to 'e_pos'
as $$
  select b.id from e_pos.branches b where b.branch_type = 'pusat' limit 1;
$$;

comment on function e_pos.pusat_branch_id() is
  'Id outlet pusat, atau null kalau belum ada outlet berjenis pusat. Migration 053.';

grant execute on function e_pos.pusat_branch_id() to authenticated, service_role;

-- 3. Pusat tidak boleh dinonaktifkan atau dihapus

create or replace function e_pos.branches_pusat_guard()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
begin
  if tg_op = 'DELETE' then
    if old.branch_type = 'pusat' then
      raise exception 'Outlet pusat tidak bisa dihapus. Ubah jenisnya menjadi cabang dulu dan jadikan outlet lain sebagai pusat.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.branch_type = 'pusat' and new.branch_type = 'pusat'
     and old.is_active and not new.is_active then
    raise exception 'Outlet pusat tidak bisa dinonaktifkan. Ubah jenisnya menjadi cabang dulu dan jadikan outlet lain sebagai pusat.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_branches_pusat_guard on e_pos.branches;
create trigger trg_branches_pusat_guard
  before update or delete on e_pos.branches
  for each row execute function e_pos.branches_pusat_guard();

commit;
