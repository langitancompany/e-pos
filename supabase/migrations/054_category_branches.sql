-- Migration 054: Kategori per outlet (pusat atau cabang)
--
-- Target schema: e_pos. WAJIB setelah 053. Aman dijalankan ulang. Satu transaksi.
--
-- Aturan, sama dengan produk:
--   * Kategori yang dibuat di pusat hanya terpasang di pusat. Pusat memasangnya ke
--     cabang yang dipilih (set_category_branch).
--   * Kategori yang dibuat di cabang hanya terpasang di cabang itu dan tidak muncul di
--     pusat. Pengguna yang dibatasi ke cabang tidak bisa memasangnya ke pusat karena
--     resolve_branch menolak outlet yang tidak boleh ia akses.
--   * category_branches hanya ditulis lewat RPC, tidak lewat insert langsung dari client.
--
-- Data lama: semua kategori dipasang di pusat, ditambah di setiap outlet yang sudah
-- punya produk berkategori itu, supaya chip kategori di kasir cabang tidak tiba-tiba kosong.

begin;

set local search_path = e_pos, public;

do $$
begin
  if to_regprocedure('e_pos.pusat_branch_id()') is null then
    raise exception 'Jalankan migration 053_branch_type.sql terlebih dulu.';
  end if;
end $$;

create table if not exists e_pos.category_branches (
  category_id uuid not null references e_pos.categories(id) on delete cascade,
  branch_id   uuid not null references e_pos.branches(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (category_id, branch_id)
);

create index if not exists category_branches_branch_idx on e_pos.category_branches (branch_id);

comment on table e_pos.category_branches is
  'Kategori yang tersedia di satu outlet. Hanya ditulis lewat RPC create_category dan set_category_branch. Migration 054.';

alter table e_pos.category_branches enable row level security;

revoke all on e_pos.category_branches from anon;
revoke insert, update, delete, truncate on e_pos.category_branches from authenticated;

drop policy if exists category_branches_select on e_pos.category_branches;
create policy category_branches_select on e_pos.category_branches
  for select to authenticated
  using (e_pos.can_access_branch(branch_id));

-- Data lama

do $$
declare
  v_pusat uuid := coalesce(
    e_pos.pusat_branch_id(),
    (select id from e_pos.branches order by sort_order, created_at limit 1)
  );
begin
  if v_pusat is null then
    raise exception 'Belum ada outlet. Tambahkan satu outlet dulu.';
  end if;

  insert into e_pos.category_branches (category_id, branch_id)
  select c.id, v_pusat from e_pos.categories c
  on conflict do nothing;

  insert into e_pos.category_branches (category_id, branch_id)
  select distinct p.category_id, pb.branch_id
    from e_pos.product_branches pb
    join e_pos.products p on p.id = pb.product_id
   where p.category_id is not null and p.deleted_at is null
  on conflict do nothing;
end $$;

-- RPC

create or replace function e_pos.create_category(
  p_name text,
  p_sort_order integer,
  p_is_active boolean,
  p_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid;
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not e_pos.has_permission_action('produk', 'create') then
    raise exception 'Anda tidak punya izin untuk menambah kategori';
  end if;
  if v_name = '' then
    raise exception 'Nama kategori wajib diisi';
  end if;

  v_branch := e_pos.resolve_branch(p_branch_id);

  insert into e_pos.categories (name, sort_order, is_active)
  values (v_name, coalesce(p_sort_order, 0), coalesce(p_is_active, true))
  returning id into v_id;

  insert into e_pos.category_branches (category_id, branch_id) values (v_id, v_branch);

  return v_id;
end;
$$;

create or replace function e_pos.set_category_branch(
  p_category_id uuid,
  p_branch_id uuid,
  p_listed boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid;
begin
  if not e_pos.has_permission_action('produk', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengatur kategori';
  end if;

  v_branch := e_pos.resolve_branch(p_branch_id);

  if not exists (select 1 from e_pos.categories where id = p_category_id) then
    raise exception 'Kategori tidak ditemukan';
  end if;

  if coalesce(p_listed, true) then
    insert into e_pos.category_branches (category_id, branch_id)
    values (p_category_id, v_branch)
    on conflict do nothing;
  else
    delete from e_pos.category_branches
     where category_id = p_category_id and branch_id = v_branch;
  end if;

  return jsonb_build_object('success', true, 'category_id', p_category_id, 'branch_id', v_branch);
end;
$$;

revoke all on function e_pos.create_category(text, integer, boolean, uuid) from public, anon;
grant execute on function e_pos.create_category(text, integer, boolean, uuid) to authenticated, service_role;
revoke all on function e_pos.set_category_branch(uuid, uuid, boolean) from public, anon;
grant execute on function e_pos.set_category_branch(uuid, uuid, boolean) to authenticated, service_role;

commit;
