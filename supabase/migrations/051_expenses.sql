-- Migration 051: Pengeluaran operasional (biaya outlet di luar pembelian stok)
--
-- Target schema: e_pos (sama dengan lib/supabase/config.ts). Aman dijalankan ulang.
--
-- Isi:
--   1. expense_categories: daftar kategori (Listrik, Gaji, Transportasi, dst.).
--      Kategori yang sudah dipakai tidak bisa dihapus, cukup dinonaktifkan.
--   2. expenses: satu baris per pengeluaran. Per outlet (branch_id), dengan
--      pembatas RLS RESTRICTIVE yang sama seperti tabel penjualan (migration 047).
--   3. RPC save_expense, delete_expense, save_expense_category,
--      set_expense_category_active, delete_expense_category.
--
-- Izin: modul baru `pengeluaran` (profiles.permissions.pengeluaran): view / create /
-- edit / delete. Super Admin selalu lolos. User lain diberi akses lewat
-- Pengaturan > Kelola User > Hak Akses.
--   view   : melihat daftar, ringkasan, dan kategori
--   create : mencatat pengeluaran, menambah kategori
--   edit   : mengubah pengeluaran, mengubah nama atau status kategori
--   delete : menghapus pengeluaran dan kategori yang belum dipakai
--
-- Pengeluaran TIDAK menyentuh kas laci/shift dan tidak mengubah stok. Ini
-- catatan biaya untuk perhitungan laba, terpisah dari menu Kas & Shift.
-- Penulisan hanya lewat RPC; tabel hanya punya policy SELECT.

set search_path = e_pos, public;

-- --------------------------------------------------------
-- 1. Kategori pengeluaran
-- --------------------------------------------------------

create table if not exists e_pos.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references e_pos.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint expense_categories_name_not_blank check (char_length(btrim(name)) >= 2)
);

create unique index if not exists expense_categories_name_unique_idx
  on e_pos.expense_categories (lower(btrim(name)));

comment on table e_pos.expense_categories is
  'Kategori pengeluaran operasional. Migration 051. Kategori yang sudah dipakai pengeluaran tidak bisa dihapus (nonaktifkan saja).';

-- --------------------------------------------------------
-- 2. Pengeluaran
-- --------------------------------------------------------

create table if not exists e_pos.expenses (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid references e_pos.branches(id),
  category_id  uuid references e_pos.expense_categories(id) on delete restrict,
  spent_at     date not null,
  amount       bigint not null check (amount > 0),
  description  text not null,
  created_by   uuid references e_pos.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references e_pos.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint expenses_description_not_blank check (char_length(btrim(description)) >= 1)
);

create index if not exists expenses_branch_spent_idx
  on e_pos.expenses (branch_id, spent_at desc, created_at desc);
create index if not exists expenses_spent_idx
  on e_pos.expenses (spent_at desc, created_at desc);
create index if not exists expenses_category_idx
  on e_pos.expenses (category_id);

comment on table e_pos.expenses is
  'Pengeluaran operasional per outlet. spent_at = tanggal kejadian (date polos, bukan timestamp). Migration 051.';

-- --------------------------------------------------------
-- 3. RLS
-- --------------------------------------------------------

alter table e_pos.expense_categories enable row level security;
alter table e_pos.expenses enable row level security;

drop policy if exists expense_categories_select on e_pos.expense_categories;
create policy expense_categories_select on e_pos.expense_categories
  for select to authenticated
  using (e_pos.has_permission_action('pengeluaran', 'view'));

drop policy if exists expenses_select on e_pos.expenses;
create policy expenses_select on e_pos.expenses
  for select to authenticated
  using (e_pos.has_permission_action('pengeluaran', 'view'));

drop policy if exists expenses_branch_scope on e_pos.expenses;
create policy expenses_branch_scope on e_pos.expenses
  as restrictive for all to authenticated
  using (e_pos.can_access_branch(branch_id))
  with check (e_pos.can_access_branch(branch_id));

revoke all on e_pos.expense_categories from anon;
revoke all on e_pos.expenses from anon;
revoke insert, update, delete on e_pos.expense_categories from authenticated;
revoke insert, update, delete on e_pos.expenses from authenticated;
grant select on e_pos.expense_categories to authenticated;
grant select on e_pos.expenses to authenticated;

-- --------------------------------------------------------
-- 4. RPC pengeluaran
-- --------------------------------------------------------

-- p_id null = catat baru, p_id terisi = ubah.
create or replace function e_pos.save_expense(
  p_id uuid,
  p_branch_id uuid,
  p_category_id uuid,
  p_spent_at date,
  p_amount bigint,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_desc  text := nullif(btrim(coalesce(p_description, '')), '');
  v_cat   e_pos.expense_categories%rowtype;
  v_old   e_pos.expenses%rowtype;
  v_id    uuid;
begin
  if p_id is null then
    if not e_pos.has_permission_action('pengeluaran', 'create') then
      raise exception 'Anda tidak punya izin untuk mencatat pengeluaran';
    end if;
  else
    if not e_pos.has_permission_action('pengeluaran', 'edit') then
      raise exception 'Anda tidak punya izin untuk mengubah pengeluaran';
    end if;
  end if;

  if v_desc is null then
    raise exception 'Keterangan wajib diisi';
  end if;
  if p_spent_at is null then
    raise exception 'Tanggal pengeluaran wajib diisi';
  end if;
  if p_spent_at > v_today then
    raise exception 'Tanggal pengeluaran tidak boleh di masa depan';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal harus lebih dari 0';
  end if;

  if p_category_id is not null then
    select * into v_cat from e_pos.expense_categories where id = p_category_id;
    if not found then
      raise exception 'Kategori tidak ditemukan';
    end if;
  end if;

  if p_id is null then
    if p_category_id is not null and not v_cat.is_active then
      raise exception 'Kategori "%" sedang nonaktif. Aktifkan dulu atau pilih kategori lain.', v_cat.name;
    end if;
    if not e_pos.can_access_branch(p_branch_id) then
      raise exception 'Anda tidak punya akses ke outlet ini';
    end if;

    insert into e_pos.expenses
      (branch_id, category_id, spent_at, amount, description, created_by)
    values
      (p_branch_id, p_category_id, p_spent_at, p_amount, v_desc,
       (select id from e_pos.profiles where id = auth.uid()))
    returning id into v_id;

    insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
    values (
      auth.uid(), 'expense_create', 'expense', v_id,
      jsonb_build_object(
        'amount', p_amount,
        'category', v_cat.name,
        'note', format('Pengeluaran Rp %s: %s', p_amount, v_desc)
      )
    );
  else
    select * into v_old from e_pos.expenses where id = p_id for update;
    if not found then
      raise exception 'Pengeluaran tidak ditemukan';
    end if;
    if not e_pos.can_access_branch(v_old.branch_id) then
      raise exception 'Anda tidak punya akses ke outlet ini';
    end if;
    if p_category_id is not null
       and not v_cat.is_active
       and p_category_id is distinct from v_old.category_id then
      raise exception 'Kategori "%" sedang nonaktif. Aktifkan dulu atau pilih kategori lain.', v_cat.name;
    end if;

    update e_pos.expenses
       set category_id = p_category_id,
           spent_at    = p_spent_at,
           amount      = p_amount,
           description = v_desc,
           updated_by  = (select id from e_pos.profiles where id = auth.uid()),
           updated_at  = now()
     where id = p_id;

    v_id := p_id;

    insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
    values (
      auth.uid(), 'expense_update', 'expense', v_id,
      jsonb_build_object(
        'amount_before', v_old.amount,
        'amount_after', p_amount,
        'note', format('Pengeluaran diubah dari Rp %s menjadi Rp %s: %s', v_old.amount, p_amount, v_desc)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'expense_id', v_id);
end;
$function$;

comment on function e_pos.save_expense(uuid, uuid, uuid, date, bigint, text) is
  'Catat (p_id null) atau ubah pengeluaran. Butuh izin pengeluaran:create atau :edit. Tanggal tidak boleh di masa depan (WIB). Dicatat di activity_logs. Migration 051.';

create or replace function e_pos.delete_expense(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $function$
declare
  v_row  e_pos.expenses%rowtype;
  v_cat  text;
begin
  if not e_pos.has_permission_action('pengeluaran', 'delete') then
    raise exception 'Anda tidak punya izin untuk menghapus pengeluaran';
  end if;

  select * into v_row from e_pos.expenses where id = p_id for update;
  if not found then
    raise exception 'Pengeluaran tidak ditemukan';
  end if;
  if not e_pos.can_access_branch(v_row.branch_id) then
    raise exception 'Anda tidak punya akses ke outlet ini';
  end if;

  select name into v_cat from e_pos.expense_categories where id = v_row.category_id;

  delete from e_pos.expenses where id = p_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'expense_delete', 'expense', p_id,
    jsonb_build_object(
      'amount', v_row.amount,
      'category', v_cat,
      'spent_at', v_row.spent_at,
      'note', format('Pengeluaran Rp %s dihapus: %s', v_row.amount, v_row.description)
    )
  );

  return jsonb_build_object('success', true, 'expense_id', p_id);
end;
$function$;

comment on function e_pos.delete_expense(uuid) is
  'Hapus permanen satu pengeluaran. Isi lamanya disimpan di activity_logs. Butuh izin pengeluaran:delete. Migration 051.';

-- --------------------------------------------------------
-- 5. RPC kategori
-- --------------------------------------------------------

-- p_id null = tambah, p_id terisi = ganti nama.
create or replace function e_pos.save_expense_category(p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id   uuid;
begin
  if p_id is null then
    if not e_pos.has_permission_action('pengeluaran', 'create') then
      raise exception 'Anda tidak punya izin untuk menambah kategori pengeluaran';
    end if;
  else
    if not e_pos.has_permission_action('pengeluaran', 'edit') then
      raise exception 'Anda tidak punya izin untuk mengubah kategori pengeluaran';
    end if;
  end if;

  if v_name is null or char_length(v_name) < 2 then
    raise exception 'Nama kategori minimal 2 karakter';
  end if;

  begin
    if p_id is null then
      insert into e_pos.expense_categories (name, created_by)
      values (v_name, (select id from e_pos.profiles where id = auth.uid()))
      returning id into v_id;
    else
      update e_pos.expense_categories
         set name = v_name, updated_at = now()
       where id = p_id
      returning id into v_id;

      if v_id is null then
        raise exception 'Kategori tidak ditemukan';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Kategori "%" sudah ada', v_name;
  end;

  return jsonb_build_object('success', true, 'category_id', v_id);
end;
$function$;

comment on function e_pos.save_expense_category(uuid, text) is
  'Tambah (p_id null) atau ganti nama kategori pengeluaran. Nama unik tanpa membedakan huruf besar/kecil. Migration 051.';

create or replace function e_pos.set_expense_category_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $function$
begin
  if not e_pos.has_permission_action('pengeluaran', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengubah kategori pengeluaran';
  end if;

  update e_pos.expense_categories
     set is_active = coalesce(p_active, true), updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'Kategori tidak ditemukan';
  end if;

  return jsonb_build_object('success', true, 'category_id', p_id);
end;
$function$;

comment on function e_pos.set_expense_category_active(uuid, boolean) is
  'Aktifkan/nonaktifkan kategori. Kategori nonaktif tidak muncul di pilihan form pengeluaran baru, riwayatnya tetap utuh. Migration 051.';

create or replace function e_pos.delete_expense_category(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $function$
declare
  v_name text;
  v_used bigint;
begin
  if not e_pos.has_permission_action('pengeluaran', 'delete') then
    raise exception 'Anda tidak punya izin untuk menghapus kategori pengeluaran';
  end if;

  select name into v_name from e_pos.expense_categories where id = p_id for update;
  if not found then
    raise exception 'Kategori tidak ditemukan';
  end if;

  select count(*) into v_used from e_pos.expenses where category_id = p_id;
  if v_used > 0 then
    raise exception 'Kategori "%" dipakai % pengeluaran sehingga tidak bisa dihapus. Nonaktifkan saja.', v_name, v_used;
  end if;

  delete from e_pos.expense_categories where id = p_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'expense_category_delete', 'expense', p_id,
    jsonb_build_object('note', format('Kategori pengeluaran "%s" dihapus', v_name))
  );

  return jsonb_build_object('success', true, 'category_id', p_id);
end;
$function$;

comment on function e_pos.delete_expense_category(uuid) is
  'Hapus kategori yang belum dipakai pengeluaran mana pun. Butuh izin pengeluaran:delete. Migration 051.';

-- --------------------------------------------------------
-- 6. Hak eksekusi
-- --------------------------------------------------------

revoke all on function e_pos.save_expense(uuid, uuid, uuid, date, bigint, text) from public, anon;
revoke all on function e_pos.delete_expense(uuid) from public, anon;
revoke all on function e_pos.save_expense_category(uuid, text) from public, anon;
revoke all on function e_pos.set_expense_category_active(uuid, boolean) from public, anon;
revoke all on function e_pos.delete_expense_category(uuid) from public, anon;

grant execute on function e_pos.save_expense(uuid, uuid, uuid, date, bigint, text) to authenticated, service_role;
grant execute on function e_pos.delete_expense(uuid) to authenticated, service_role;
grant execute on function e_pos.save_expense_category(uuid, text) to authenticated, service_role;
grant execute on function e_pos.set_expense_category_active(uuid, boolean) to authenticated, service_role;
grant execute on function e_pos.delete_expense_category(uuid) to authenticated, service_role;
