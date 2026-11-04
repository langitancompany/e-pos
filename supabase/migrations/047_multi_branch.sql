-- Migration 047: Multi cabang (multi-branch)
--
-- Target schema: e_pos (sama dengan schema_e_pos.sql / lib/supabase/config.ts).
-- Aman dijalankan ulang (idempotent).
--
-- Isi:
--   1. Tabel `branches` (daftar cabang/toko) + seed "Cabang Utama" dari settings.
--   2. `profiles.branch_ids uuid[]` = batasan cabang per user.
--        KOSONG ({}) = TIDAK ADA BATASAN -> boleh akses SEMUA cabang.
--        Super Admin selalu boleh semua cabang, apa pun isi kolom ini.
--   3. Fungsi `can_access_branch(uuid)`.
--   4. Kolom `branch_id` di tabel sisi penjualan: shift_sessions, transactions,
--      cash_movements, held_orders (+ backfill data lama ke cabang utama).
--   5. Trigger: transactions & cash_movements otomatis mengambil branch_id dari
--      shift-nya, jadi RPC create_transaction / return_transaction /
--      add_cash_movement TIDAK perlu diubah.
--   6. RLS RESTRICTIVE: user hanya bisa membaca/menulis data cabang yang boleh
--      ia akses. Policy RESTRICTIVE di-AND dengan policy lama, jadi policy
--      yang sudah ada tidak disentuh.
--   7. Trigger penjaga profiles: branch_ids diperlakukan seperti roles/permissions
--      (tidak bisa diubah sendiri / oleh user tanpa izin pengaturan_admin.edit).
--
-- YANG BELUM DIPISAH PER CABANG (sengaja, lihat catatan penyerahan):
--   katalog produk, kategori, pelanggan, dan STOK masih satu untuk semua cabang.

set search_path = e_pos, public;

-- --------------------------------------------------------
-- 1. Tabel branches
-- --------------------------------------------------------

create table if not exists e_pos.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint branches_name_not_blank check (char_length(btrim(name)) >= 2)
);

create unique index if not exists branches_name_unique_idx
  on e_pos.branches (lower(btrim(name)));
create unique index if not exists branches_code_unique_idx
  on e_pos.branches (lower(btrim(code))) where code is not null and btrim(code) <> '';

comment on table e_pos.branches is
  'Daftar cabang/toko. Migration 047. Cabang tidak pernah dihapus (data transaksi merujuk ke sini) — cukup dinonaktifkan (is_active = false).';

-- Seed: cabang utama dari pengaturan toko yang sudah ada (hanya kalau tabel masih kosong).
insert into e_pos.branches (name, address, phone, sort_order)
select
  coalesce(nullif(btrim((select value #>> '{}' from e_pos.settings where key = 'nama_toko')), ''), 'Cabang Utama'),
  nullif(btrim((select value #>> '{}' from e_pos.settings where key = 'alamat')), ''),
  nullif(btrim((select value #>> '{}' from e_pos.settings where key = 'telepon')), ''),
  0
where not exists (select 1 from e_pos.branches);

-- --------------------------------------------------------
-- 2. Batasan cabang per user
-- --------------------------------------------------------

alter table e_pos.profiles
  add column if not exists branch_ids uuid[] not null default '{}'::uuid[];

comment on column e_pos.profiles.branch_ids is
  'Batasan cabang yang boleh diakses user ini. Kosong = tanpa batasan (semua cabang). Super Admin selalu semua cabang. Migration 047.';

-- --------------------------------------------------------
-- 3. Fungsi can_access_branch
-- --------------------------------------------------------

create or replace function e_pos.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'e_pos'
as $$
  -- Baris tanpa cabang (data lama yang belum ter-backfill) tetap terlihat.
  select p_branch_id is null
    or exists (
      select 1 from e_pos.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and (
          'super_admin' = any(p.roles)
          or cardinality(p.branch_ids) = 0
          or p_branch_id = any(p.branch_ids)
        )
    );
$$;

comment on function e_pos.can_access_branch(uuid) is
  'True kalau user login boleh mengakses cabang tsb: Super Admin, user tanpa batasan (branch_ids kosong), atau cabang ada di branch_ids. Migration 047.';

-- --------------------------------------------------------
-- 4. Kolom branch_id + backfill
-- --------------------------------------------------------

alter table e_pos.shift_sessions add column if not exists branch_id uuid references e_pos.branches(id);
alter table e_pos.transactions   add column if not exists branch_id uuid references e_pos.branches(id);
alter table e_pos.cash_movements add column if not exists branch_id uuid references e_pos.branches(id);
alter table e_pos.held_orders    add column if not exists branch_id uuid references e_pos.branches(id);

do $$
declare
  v_default uuid;
begin
  select id into v_default from e_pos.branches order by sort_order, created_at limit 1;

  update e_pos.shift_sessions set branch_id = v_default where branch_id is null;
  update e_pos.held_orders    set branch_id = v_default where branch_id is null;

  update e_pos.transactions t
     set branch_id = coalesce((select s.branch_id from e_pos.shift_sessions s where s.id = t.shift_id), v_default)
   where t.branch_id is null;

  update e_pos.cash_movements c
     set branch_id = coalesce((select s.branch_id from e_pos.shift_sessions s where s.id = c.shift_id), v_default)
   where c.branch_id is null;
end $$;

create index if not exists shift_sessions_branch_idx on e_pos.shift_sessions (branch_id, opened_at desc);
create index if not exists transactions_branch_idx   on e_pos.transactions (branch_id, created_at desc);
create index if not exists cash_movements_branch_idx on e_pos.cash_movements (branch_id, created_at desc);
create index if not exists held_orders_branch_idx    on e_pos.held_orders (branch_id);

-- --------------------------------------------------------
-- 5. Trigger pengisi branch_id
-- --------------------------------------------------------

-- shift_sessions & held_orders: kalau client lama tidak mengirim branch_id,
-- jatuh ke cabang utama (cabang pertama) supaya tidak ada baris tanpa cabang.
create or replace function e_pos.set_branch_default()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
begin
  if new.branch_id is null then
    select id into new.branch_id from e_pos.branches
     where is_active = true order by sort_order, created_at limit 1;
  end if;
  return new;
end;
$$;

-- transactions & cash_movements: ikut cabang shift-nya.
create or replace function e_pos.set_branch_from_shift()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
begin
  if new.branch_id is null and new.shift_id is not null then
    select s.branch_id into new.branch_id from e_pos.shift_sessions s where s.id = new.shift_id;
  end if;
  if new.branch_id is null then
    select id into new.branch_id from e_pos.branches
     where is_active = true order by sort_order, created_at limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shift_sessions_branch on e_pos.shift_sessions;
create trigger trg_shift_sessions_branch before insert on e_pos.shift_sessions
  for each row execute function e_pos.set_branch_default();

drop trigger if exists trg_held_orders_branch on e_pos.held_orders;
create trigger trg_held_orders_branch before insert on e_pos.held_orders
  for each row execute function e_pos.set_branch_default();

drop trigger if exists trg_transactions_branch on e_pos.transactions;
create trigger trg_transactions_branch before insert on e_pos.transactions
  for each row execute function e_pos.set_branch_from_shift();

drop trigger if exists trg_cash_movements_branch on e_pos.cash_movements;
create trigger trg_cash_movements_branch before insert on e_pos.cash_movements
  for each row execute function e_pos.set_branch_from_shift();

-- --------------------------------------------------------
-- 6. RLS
-- --------------------------------------------------------

alter table e_pos.branches enable row level security;

-- Baca: hanya cabang yang boleh diakses (user dengan batasan tidak melihat cabang lain).
drop policy if exists branches_select_accessible on e_pos.branches;
create policy branches_select_accessible on e_pos.branches
  for select to authenticated
  using (e_pos.can_access_branch(id));

-- Tambah/ubah cabang: izin Pengaturan > Toko & Struk (pengaturan_toko).
drop policy if exists branches_insert_pengaturan_toko on e_pos.branches;
create policy branches_insert_pengaturan_toko on e_pos.branches
  for insert to authenticated
  with check (e_pos.has_permission_action('pengaturan_toko', 'create'));

drop policy if exists branches_update_pengaturan_toko on e_pos.branches;
create policy branches_update_pengaturan_toko on e_pos.branches
  for update to authenticated
  using (e_pos.has_permission_action('pengaturan_toko', 'edit'))
  with check (e_pos.has_permission_action('pengaturan_toko', 'edit'));
-- (tidak ada policy DELETE: cabang dinonaktifkan, bukan dihapus)

-- Pembatas cabang pada tabel sisi penjualan (RESTRICTIVE = di-AND dengan policy lama).
do $$
declare
  t text;
begin
  foreach t in array array['shift_sessions', 'transactions', 'cash_movements', 'held_orders']
  loop
    execute format('drop policy if exists %I on e_pos.%I', t || '_branch_scope', t);
    execute format(
      'create policy %I on e_pos.%I as restrictive for all to authenticated '
      'using (e_pos.can_access_branch(branch_id)) '
      'with check (e_pos.can_access_branch(branch_id))',
      t || '_branch_scope', t
    );
  end loop;
end $$;

-- --------------------------------------------------------
-- 7. Penjaga perubahan profiles (tambah branch_ids)
-- --------------------------------------------------------
-- Sama dengan versi migration 038, hanya syarat "tidak ada perubahan" dan
-- aturan non-Super-Admin diperluas ke kolom branch_ids.

create or replace function e_pos.enforce_profiles_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_caller_roles text[];
  v_caller_perms jsonb;
  v_caller_active boolean;
  v_caller_super boolean;
  v_old_super boolean;
  v_new_super boolean;
  v_over text;
begin
  if new.roles is not distinct from old.roles
     and new.permissions is not distinct from old.permissions
     and new.branch_ids is not distinct from old.branch_ids
     and new.is_active = old.is_active then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  select p.roles, p.permissions, p.is_active
    into v_caller_roles, v_caller_perms, v_caller_active
  from e_pos.profiles p
  where p.id = auth.uid();

  v_caller_super := coalesce(v_caller_active, false) and 'super_admin' = any(coalesce(v_caller_roles, '{}'::text[]));
  v_old_super := 'super_admin' = any(old.roles);
  v_new_super := 'super_admin' = any(new.roles);

  if v_old_super and old.is_active
     and (not v_new_super or not new.is_active)
     and not exists (
       select 1 from e_pos.profiles o
       where o.id <> old.id and o.is_active = true and 'super_admin' = any(o.roles)
     ) then
    raise exception 'Tidak bisa menurunkan atau menonaktifkan Super Admin terakhir'
      using errcode = '42501';
  end if;

  if v_caller_super then
    return new;
  end if;

  if not e_pos.has_permission_action('pengaturan_admin', 'edit') then
    raise exception 'Anda tidak punya izin mengubah role, hak akses, batasan cabang, atau status user'
      using errcode = '42501';
  end if;

  if v_new_super and not v_old_super then
    raise exception 'Hanya Super Admin yang boleh memberi role Super Admin'
      using errcode = '42501';
  end if;

  if v_old_super then
    raise exception 'Hanya Super Admin yang boleh mengubah akun Super Admin'
      using errcode = '42501';
  end if;

  if new.id = auth.uid() then
    raise exception 'Tidak bisa mengubah role, hak akses, batasan cabang, atau status akun Anda sendiri'
      using errcode = '42501';
  end if;

  if new.permissions is distinct from old.permissions then
    v_over := e_pos.perms_added_beyond(new.permissions, old.permissions, v_caller_perms);
    if v_over is not null then
      raise exception 'Tidak bisa memberi izin yang tidak Anda miliki: %', v_over
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

grant execute on function e_pos.can_access_branch(uuid) to authenticated, service_role;
