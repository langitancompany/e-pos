-- Migration 052: Produk, harga, dan stok per outlet
--
-- Target schema: e_pos. WAJIB setelah 047, 048, dan 049. Aman dijalankan ulang.
-- Dijalankan dalam satu transaksi: kalau ada langkah gagal, tidak ada yang berubah.
--
-- Model (mengikuti alur Kula POS):
--   * Master produk (products) tetap satu untuk semua outlet.
--   * product_branches = ketersediaan produk di satu outlet: aktif/tidak,
--     stok, minimum stok, dan harga khusus outlet (price_override, null = harga master).
--   * products.stock tetap ada sebagai TOTAL semua outlet (jumlah product_branches.stock),
--     supaya RPC dan laporan lama tidak patah.
--   * Tabel product_branches hanya ditulis lewat RPC dan trigger stock_movements,
--     tidak boleh lewat UPDATE langsung dari client.
--
-- Perubahan perilaku yang perlu diketahui:
--   1. Stok lama dipindah ke outlet utama (outlet pertama menurut sort_order).
--      Outlet lain mulai kosong sampai produk diaktifkan di sana (Stok > Transfer
--      atau Produk > Atur Outlet). Produk jasa otomatis aktif di semua outlet.
--   2. Seluruh riwayat mutasi stok lama dicatat di outlet utama, karena sebelum
--      migration ini stok adalah satu tumpukan.
--   3. Penjualan, retur, dan void mengikuti outlet transaksinya. Retur mengembalikan
--      stok ke outlet tempat barang dijual, bukan outlet kasir yang memproses retur.
--   4. RPC adjust_stock, receive_stock, start_stock_opname, give_gift, dan
--      stock_movement_summary menerima p_branch_id. Client lama (tanpa p_branch_id)
--      akan ditolak dengan pesan "Pilih outlet terlebih dulu".
--   5. RPC create_transaction, return_transaction, dan void_transaction TIDAK diubah:
--      trigger pada stock_movements dan transaction_items yang menegakkan aturan outlet.

begin;

set local search_path = e_pos, public;

do $$
begin
  if to_regclass('e_pos.branches') is null then
    raise exception 'Jalankan migration 047_multi_branch.sql terlebih dulu.';
  end if;
  if to_regprocedure('e_pos.can_access_branch(uuid)') is null
     or to_regprocedure('e_pos.current_branch_id()') is null then
    raise exception 'Fungsi cabang belum lengkap. Jalankan migration 047 dan 048 terlebih dulu.';
  end if;
  if to_regprocedure('e_pos.delete_branch(uuid)') is null then
    raise exception 'Jalankan migration 049_delete_branch.sql terlebih dulu.';
  end if;
end $$;

-- Tabel ketersediaan produk per outlet

create table if not exists e_pos.product_branches (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references e_pos.products(id) on delete cascade,
  branch_id      uuid not null references e_pos.branches(id),
  stock          integer not null default 0,
  min_stock      integer not null default 0,
  price_override bigint,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint product_branches_unique unique (product_id, branch_id),
  constraint product_branches_min_stock_nonneg check (min_stock >= 0),
  constraint product_branches_price_positive check (price_override is null or price_override > 0)
);

create index if not exists product_branches_branch_idx
  on e_pos.product_branches (branch_id, is_active);

comment on table e_pos.product_branches is
  'Ketersediaan, stok, minimum stok, dan harga khusus satu produk di satu outlet. Hanya ditulis lewat RPC dan trigger stock_movements. Migration 052.';
comment on column e_pos.product_branches.stock is
  'Stok produk di outlet ini. Jumlah seluruh outlet sama dengan products.stock.';
comment on column e_pos.product_branches.price_override is
  'Harga jual khusus outlet. Null memakai products.sell_price.';
comment on column e_pos.product_branches.is_active is
  'False menyembunyikan produk dari kasir outlet ini tanpa menghapus stoknya.';

-- Kolom outlet pada tabel stok

alter table e_pos.stock_movements add column if not exists branch_id uuid references e_pos.branches(id);
alter table e_pos.stock_receipts add column if not exists branch_id uuid references e_pos.branches(id);
alter table e_pos.stock_opname_sessions add column if not exists branch_id uuid references e_pos.branches(id);
alter table e_pos.gift_records add column if not exists branch_id uuid references e_pos.branches(id);

-- Backfill: stok lama menjadi milik outlet utama

do $$
declare
  v_default uuid;
  v_negative integer;
begin
  select id into v_default from e_pos.branches order by sort_order, created_at limit 1;
  if v_default is null then
    raise exception 'Belum ada outlet. Tambahkan satu outlet dulu.';
  end if;

  update e_pos.stock_movements set branch_id = v_default where branch_id is null;
  update e_pos.stock_receipts set branch_id = v_default where branch_id is null;
  update e_pos.stock_opname_sessions set branch_id = v_default where branch_id is null;
  update e_pos.gift_records set branch_id = v_default where branch_id is null;

  select count(*) into v_negative from e_pos.products where coalesce(stock, 0) < 0;
  if v_negative > 0 then
    raise notice '% produk punya stok negatif di data lama; di outlet utama dicatat sebagai 0.', v_negative;
  end if;

  insert into e_pos.product_branches (product_id, branch_id, stock, min_stock, is_active)
  select p.id, v_default, greatest(coalesce(p.stock, 0), 0), greatest(coalesce(p.min_stock, 0), 0),
         coalesce(p.is_active, true)
    from e_pos.products p
  on conflict (product_id, branch_id) do nothing;

  insert into e_pos.product_branches (product_id, branch_id, stock, min_stock, is_active)
  select p.id, b.id, 0, 0, coalesce(p.is_active, true)
    from e_pos.products p
   cross join e_pos.branches b
   where coalesce(p.is_service, false) = true or p.type = 'JASA'
  on conflict (product_id, branch_id) do nothing;
end $$;

alter table e_pos.stock_receipts alter column branch_id set not null;
alter table e_pos.stock_opname_sessions alter column branch_id set not null;
alter table e_pos.gift_records alter column branch_id set not null;

-- NOT VALID: baris lama yang kebetulan negatif tidak menggagalkan migration,
-- tetapi semua penulisan baru tetap diperiksa.
alter table e_pos.product_branches drop constraint if exists product_branches_stock_nonneg;
alter table e_pos.product_branches
  add constraint product_branches_stock_nonneg check (stock >= 0) not valid;

create index if not exists stock_movements_branch_created_idx
  on e_pos.stock_movements (branch_id, created_at desc);
create index if not exists stock_movements_product_branch_idx
  on e_pos.stock_movements (product_id, branch_id);
create index if not exists stock_receipts_branch_idx
  on e_pos.stock_receipts (branch_id, received_at desc);
create index if not exists stock_opname_sessions_branch_idx
  on e_pos.stock_opname_sessions (branch_id, status);
create index if not exists gift_records_branch_idx
  on e_pos.gift_records (branch_id, given_at desc);

-- Jenis mutasi transfer antar outlet

alter table e_pos.stock_movements drop constraint if exists stock_movements_type_check;
alter table e_pos.stock_movements
  add constraint stock_movements_type_check check (type = any (array[
    'sale', 'return', 'opname', 'adjustment', 'void', 'stock_in', 'initial', 'gift',
    'transfer_out', 'transfer_in'
  ]));

comment on column e_pos.stock_movements.type is
  'sale = penjualan, return = retur masuk, void = pembatalan transaksi, opname = hasil hitung fisik, adjustment = penyesuaian manual, stock_in = barang masuk, initial = stok awal di outlet, gift = hadiah keluar atau pembatalannya, transfer_out / transfer_in = pindah stok antar outlet.';
comment on column e_pos.stock_movements.branch_id is
  'Outlet yang stoknya berubah. Diisi RPC, atau trigger dari transaksi/hadiah sumbernya. Migration 052.';

-- Dokumen transfer stok antar outlet

create table if not exists e_pos.stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  number         bigint generated always as identity,
  from_branch_id uuid not null references e_pos.branches(id),
  to_branch_id   uuid not null references e_pos.branches(id),
  note           text,
  status         text not null default 'completed',
  item_count     integer not null default 0,
  total_qty      integer not null default 0,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint stock_transfers_status_check check (status = 'completed'),
  constraint stock_transfers_distinct_branches check (from_branch_id <> to_branch_id)
);

create unique index if not exists stock_transfers_number_key on e_pos.stock_transfers (number);
create index if not exists stock_transfers_created_idx on e_pos.stock_transfers (created_at desc);
create index if not exists stock_transfers_from_idx on e_pos.stock_transfers (from_branch_id, created_at desc);
create index if not exists stock_transfers_to_idx on e_pos.stock_transfers (to_branch_id, created_at desc);

create table if not exists e_pos.stock_transfer_items (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references e_pos.stock_transfers(id) on delete cascade,
  product_id      uuid references e_pos.products(id) on delete set null,
  product_name    text not null,
  product_sku     text,
  product_unit    text,
  qty             integer not null check (qty > 0),
  out_movement_id uuid,
  in_movement_id  uuid
);

create index if not exists stock_transfer_items_transfer_idx on e_pos.stock_transfer_items (transfer_id);

comment on table e_pos.stock_transfers is
  'Dokumen pindah stok antar outlet. Total stok semua outlet tidak berubah. Migration 052.';

-- Akses dan RLS

alter table e_pos.product_branches enable row level security;
alter table e_pos.stock_transfers enable row level security;
alter table e_pos.stock_transfer_items enable row level security;

revoke all on e_pos.product_branches from anon;
revoke insert, update, delete, truncate on e_pos.product_branches from authenticated;
revoke all on e_pos.stock_transfers from anon;
revoke insert, update, delete, truncate on e_pos.stock_transfers from authenticated;
revoke all on e_pos.stock_transfer_items from anon;
revoke insert, update, delete, truncate on e_pos.stock_transfer_items from authenticated;

drop policy if exists product_branches_select on e_pos.product_branches;
create policy product_branches_select on e_pos.product_branches
  for select to authenticated
  using (e_pos.can_access_branch(branch_id));

drop policy if exists stock_transfers_select on e_pos.stock_transfers;
create policy stock_transfers_select on e_pos.stock_transfers
  for select to authenticated
  using (
    e_pos.has_permission_action('stok', 'view')
    and (e_pos.can_access_branch(from_branch_id) or e_pos.can_access_branch(to_branch_id))
  );

drop policy if exists stock_transfer_items_select on e_pos.stock_transfer_items;
create policy stock_transfer_items_select on e_pos.stock_transfer_items
  for select to authenticated
  using (exists (select 1 from e_pos.stock_transfers t where t.id = transfer_id));

-- Pembatas outlet (RESTRICTIVE: di-AND dengan policy lama, policy lama tidak disentuh).
do $$
declare
  t text;
begin
  foreach t in array array['stock_movements', 'stock_receipts', 'stock_opname_sessions', 'gift_records']
  loop
    execute format('drop policy if exists %I on e_pos.%I', t || '_branch_scope', t);
    execute format(
      'create policy %I on e_pos.%I as restrictive for select to authenticated '
      'using (e_pos.can_access_branch(branch_id))',
      t || '_branch_scope', t
    );
  end loop;
end $$;

-- Fungsi bantu

create or replace function e_pos.resolve_branch(p_branch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'e_pos'
as $$
begin
  if p_branch_id is null then
    raise exception 'Pilih outlet terlebih dulu';
  end if;
  if not exists (select 1 from e_pos.branches b where b.id = p_branch_id) then
    raise exception 'Outlet tidak ditemukan';
  end if;
  if not e_pos.can_access_branch(p_branch_id) then
    raise exception 'Anda tidak punya akses ke outlet ini';
  end if;
  return p_branch_id;
end;
$$;

comment on function e_pos.resolve_branch(uuid) is
  'Validasi outlet untuk RPC stok: wajib diisi, ada, dan boleh diakses pemanggil. Migration 052.';

-- Trigger stock_movements: tentukan outlet, tolak stok minus per outlet, lalu terapkan ke product_branches.
-- Urutan outlet: kolom branch_id yang diisi RPC, transaksi/hadiah sumber, shift yang sedang buka, outlet aktif pertama.

create or replace function e_pos.stock_movement_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid := new.branch_id;
  v_stock integer;
begin
  if v_branch is null and new.reference_id is not null then
    select t.branch_id into v_branch from e_pos.transactions t where t.id = new.reference_id;
    if v_branch is null then
      select g.branch_id into v_branch from e_pos.gift_records g where g.id = new.reference_id;
    end if;
  end if;

  if v_branch is null then
    v_branch := e_pos.current_branch_id();
  end if;

  if v_branch is null then
    select b.id into v_branch from e_pos.branches b
     where b.is_active order by b.sort_order, b.created_at limit 1;
  end if;

  new.branch_id := v_branch;

  if new.qty_delta < 0 and new.product_id is not null then
    select pb.stock into v_stock
      from e_pos.product_branches pb
     where pb.product_id = new.product_id and pb.branch_id = v_branch
     for update;

    if coalesce(v_stock, 0) + new.qty_delta < 0 then
      raise exception 'Stok "%" di outlet ini tidak cukup. Tersedia %, dibutuhkan %',
        coalesce((select p.name from e_pos.products p where p.id = new.product_id), '?'),
        coalesce(v_stock, 0), -new.qty_delta;
    end if;
  end if;

  return new;
end;
$$;

create or replace function e_pos.stock_movement_after_insert()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
begin
  if new.product_id is null or new.branch_id is null then
    return new;
  end if;

  -- Baris baru hanya otomatis aktif kalau stok masuk lewat jalur yang memang
  -- menyiapkan produk untuk dijual; retur/void ke produk yang sudah dilepas tetap tersembunyi.
  -- Baris yang diusulkan diperiksa CHECK (stock >= 0) sebelum konflik dicek, jadi
  -- delta negatif tidak boleh masuk ke VALUES. Mutasi negatif ke baris yang belum ada
  -- sudah ditolak trigger BEFORE.
  insert into e_pos.product_branches (product_id, branch_id, stock, is_active)
  values (new.product_id, new.branch_id, greatest(new.qty_delta, 0),
          new.type in ('initial', 'stock_in', 'transfer_in'))
  on conflict (product_id, branch_id) do update
    set stock = e_pos.product_branches.stock + new.qty_delta,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_stock_movements_before_insert on e_pos.stock_movements;
create trigger trg_stock_movements_before_insert
  before insert on e_pos.stock_movements
  for each row execute function e_pos.stock_movement_before_insert();

drop trigger if exists trg_stock_movements_after_insert on e_pos.stock_movements;
create trigger trg_stock_movements_after_insert
  after insert on e_pos.stock_movements
  for each row execute function e_pos.stock_movement_after_insert();

-- Trigger transaction_items: produk harus dijual di outlet transaksinya (termasuk produk jasa).
-- Baris retur (status RETURN) tidak diperiksa.

create or replace function e_pos.transaction_item_listing_guard()
returns trigger
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid;
  v_status text;
  v_listed boolean;
begin
  if new.product_id is null then
    return new;
  end if;

  select t.branch_id, t.status::text into v_branch, v_status
    from e_pos.transactions t where t.id = new.transaction_id;

  if v_branch is null or v_status is distinct from 'PAID' then
    return new;
  end if;

  select pb.is_active into v_listed
    from e_pos.product_branches pb
   where pb.product_id = new.product_id and pb.branch_id = v_branch;

  if coalesce(v_listed, false) = false then
    raise exception 'Produk "%" tidak dijual di outlet ini', new.product_name;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_transaction_items_listing on e_pos.transaction_items;
create trigger trg_transaction_items_listing
  before insert on e_pos.transaction_items
  for each row execute function e_pos.transaction_item_listing_guard();

-- Kartu stok per outlet: saldo sesudah mutasi dihitung dari stok outlet.
-- Kolom lama dipertahankan urutannya; branch_id ditambahkan di akhir.

create or replace view e_pos.stock_ledger with (security_invoker = 'true') as
select
  m.id,
  m.product_id,
  m.type,
  m.qty_delta,
  m.reference_id,
  m.reason,
  m.created_by,
  m.created_at,
  p.name as product_name,
  p.sku as product_sku,
  p.unit as product_unit,
  case
    when m.product_id is null or p.id is null then null::integer
    else (
      coalesce(pb.stock, 0)
      - coalesce(
          sum(m.qty_delta) over (
            partition by m.product_id, m.branch_id
            order by m.created_at desc, m.id desc
            rows between unbounded preceding and 1 preceding
          ), 0)
    )::integer
  end as stock_after,
  m.branch_id
from e_pos.stock_movements m
left join e_pos.products p on p.id = m.product_id
left join e_pos.product_branches pb on pb.product_id = m.product_id and pb.branch_id = m.branch_id;

-- Daftar sesi opname ikut membawa outlet (kolom baru di akhir, kolom lama tidak berubah).

create or replace view e_pos.stock_opname_session_stats with (security_invoker = 'true') as
select
  s.id, s.number, s.name, s.category_id, s.category_name, s.status, s.note,
  s.created_by, s.created_at, s.finalized_by, s.finalized_at,
  s.cancelled_by, s.cancelled_at, s.cancel_reason,
  coalesce(c.item_count, 0::bigint) as item_count,
  coalesce(c.counted_count, 0::bigint) as counted_count,
  coalesce(c.diff_count, 0::bigint) as diff_count,
  coalesce(c.diff_qty, 0::bigint) as diff_qty,
  coalesce(c.diff_value, 0::numeric)::bigint as diff_value,
  s.branch_id
from e_pos.stock_opname_sessions s
left join lateral (
  select count(*) as item_count,
         count(i.counted_qty) as counted_count,
         count(*) filter (where i.counted_qty is not null and i.counted_qty <> i.system_qty) as diff_count,
         sum(i.counted_qty - i.system_qty) filter (where i.counted_qty is not null) as diff_qty,
         sum((i.counted_qty - i.system_qty)::bigint * coalesce(i.cost_price, 0::bigint))
           filter (where i.counted_qty is not null) as diff_value
    from e_pos.stock_opname_items i
   where i.session_id = s.id
) c on true;

-- RPC ketersediaan produk per outlet

create or replace function e_pos.assign_product_branch(
  p_product_id uuid,
  p_branch_id uuid,
  p_stock integer default 0,
  p_min_stock integer default null,
  p_price_override bigint default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid;
  v_product e_pos.products%rowtype;
  v_row e_pos.product_branches%rowtype;
  v_service boolean;
  v_stock integer := coalesce(p_stock, 0);
  v_min integer;
begin
  if not e_pos.has_permission_action('produk', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengatur ketersediaan produk';
  end if;

  v_branch := e_pos.resolve_branch(p_branch_id);

  select * into v_product from e_pos.products
   where id = p_product_id and deleted_at is null
   for update;
  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;

  v_service := coalesce(v_product.is_service, false) or v_product.type = 'JASA';

  if v_stock < 0 then
    raise exception 'Stok awal tidak boleh negatif';
  end if;
  if v_stock > 0 then
    if v_service then
      raise exception 'Produk "%" adalah jasa dan tidak punya stok', v_product.name;
    end if;
    if not e_pos.has_permission_action('stok', 'edit') then
      raise exception 'Mengisi stok awal butuh izin ubah stok';
    end if;
  end if;

  if p_price_override is not null and p_price_override <= 0 then
    raise exception 'Harga khusus outlet harus lebih dari 0';
  end if;

  v_min := case when v_service then 0 else coalesce(p_min_stock, v_product.min_stock, 0) end;
  if v_min < 0 then
    raise exception 'Minimum stok tidak boleh negatif';
  end if;

  select * into v_row from e_pos.product_branches
   where product_id = p_product_id and branch_id = v_branch
   for update;

  if found then
    if v_stock > 0 and (
      v_row.stock > 0
      or exists (select 1 from e_pos.stock_movements m
                  where m.product_id = p_product_id and m.branch_id = v_branch)
    ) then
      raise exception 'Produk "%" sudah punya stok atau riwayat di outlet ini. Pakai Barang Masuk, Opname, atau Penyesuaian.', v_product.name;
    end if;

    update e_pos.product_branches
       set is_active = true,
           min_stock = case when v_service then 0 else coalesce(p_min_stock, min_stock) end,
           price_override = coalesce(p_price_override, price_override),
           updated_at = now()
     where id = v_row.id;
  else
    insert into e_pos.product_branches (product_id, branch_id, stock, min_stock, price_override, is_active)
    values (p_product_id, v_branch, 0, v_min, p_price_override, true);
  end if;

  if v_stock > 0 then
    update e_pos.products
       set stock = coalesce(stock, 0) + v_stock, updated_at = now()
     where id = p_product_id;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      p_product_id, 'initial', v_stock, null,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Stok awal di outlet'),
      auth.uid(), v_branch
    );
  end if;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_branch_assign', 'product', p_product_id,
    jsonb_build_object(
      'product_name', v_product.name,
      'branch_id', v_branch,
      'initial_stock', v_stock,
      'price_override', p_price_override
    )
  );

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'branch_id', v_branch,
    'initial_stock', v_stock
  );
end;
$$;

create or replace function e_pos.bulk_assign_product_branch(
  p_branch_id uuid,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid;
  v_assigned integer := 0;
  v_reactivated integer := 0;
begin
  if not e_pos.has_permission_action('produk', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengatur ketersediaan produk';
  end if;

  v_branch := e_pos.resolve_branch(p_branch_id);

  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'Pilih minimal satu produk';
  end if;
  if cardinality(p_product_ids) > 2000 then
    raise exception 'Maksimal 2000 produk sekali aktifkan';
  end if;

  with ins as (
    insert into e_pos.product_branches (product_id, branch_id, stock, min_stock, is_active)
    select p.id, v_branch, 0,
           case when coalesce(p.is_service, false) or p.type = 'JASA' then 0
                else greatest(coalesce(p.min_stock, 0), 0) end,
           true
      from e_pos.products p
     where p.id = any(p_product_ids) and p.deleted_at is null
    on conflict (product_id, branch_id) do nothing
    returning 1
  )
  select count(*) into v_assigned from ins;

  with upd as (
    update e_pos.product_branches pb
       set is_active = true, updated_at = now()
      from e_pos.products p
     where pb.product_id = p.id
       and pb.branch_id = v_branch
       and p.id = any(p_product_ids)
       and p.deleted_at is null
       and pb.is_active = false
    returning 1
  )
  select count(*) into v_reactivated from upd;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_branch_bulk_assign', 'branch', v_branch,
    jsonb_build_object('assigned', v_assigned, 'reactivated', v_reactivated)
  );

  return jsonb_build_object(
    'success', true,
    'branch_id', v_branch,
    'assigned', v_assigned,
    'reactivated', v_reactivated
  );
end;
$$;

create or replace function e_pos.update_product_branch(
  p_product_id uuid,
  p_branch_id uuid,
  p_is_active boolean default null,
  p_min_stock integer default null,
  p_price_override bigint default null,
  p_clear_price_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_branch uuid;
  v_row e_pos.product_branches%rowtype;
begin
  if not e_pos.has_permission_action('produk', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengubah produk';
  end if;

  v_branch := e_pos.resolve_branch(p_branch_id);

  if p_min_stock is not null and p_min_stock < 0 then
    raise exception 'Minimum stok tidak boleh negatif';
  end if;
  if p_price_override is not null and p_price_override <= 0 then
    raise exception 'Harga khusus outlet harus lebih dari 0';
  end if;

  select * into v_row from e_pos.product_branches
   where product_id = p_product_id and branch_id = v_branch
   for update;
  if not found then
    raise exception 'Produk ini belum diaktifkan di outlet tersebut';
  end if;

  update e_pos.product_branches
     set is_active = coalesce(p_is_active, is_active),
         min_stock = coalesce(p_min_stock, min_stock),
         price_override = case
           when coalesce(p_clear_price_override, false) then null
           else coalesce(p_price_override, price_override)
         end,
         updated_at = now()
   where id = v_row.id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_branch_update', 'product', p_product_id,
    jsonb_build_object(
      'branch_id', v_branch,
      'is_active', p_is_active,
      'min_stock', p_min_stock,
      'price_override', p_price_override,
      'clear_price_override', coalesce(p_clear_price_override, false)
    )
  );

  return jsonb_build_object('success', true, 'product_id', p_product_id, 'branch_id', v_branch);
end;
$$;

-- RPC transfer stok antar outlet

create or replace function e_pos.transfer_stock(
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_items jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'e_pos'
as $$
declare
  v_from uuid;
  v_to uuid;
  v_from_name text;
  v_to_name text;
  v_dup uuid;
  v_transfer_id uuid;
  v_number bigint;
  v_item record;
  v_product e_pos.products%rowtype;
  v_src e_pos.product_branches%rowtype;
  v_out_id uuid;
  v_in_id uuid;
  v_item_count integer;
  v_total_qty bigint;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk memindahkan stok';
  end if;

  v_from := e_pos.resolve_branch(p_from_branch_id);
  v_to := e_pos.resolve_branch(p_to_branch_id);

  if v_from = v_to then
    raise exception 'Outlet asal dan tujuan harus berbeda';
  end if;

  select name into v_from_name from e_pos.branches where id = v_from;
  select name into v_to_name from e_pos.branches where id = v_to;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu produk yang dipindahkan';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Maksimal 200 produk per transfer';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) where product_id is null) then
    raise exception 'Ada baris tanpa produk';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) where qty is null or qty <= 0) then
    raise exception 'Jumlah transfer harus berupa angka bulat lebih dari 0';
  end if;

  select product_id into v_dup
    from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer)
   group by product_id having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Produk yang sama muncul lebih dari satu kali. Gabungkan jumlahnya jadi satu baris.';
  end if;

  select count(*), sum(qty) into v_item_count, v_total_qty
    from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer);

  insert into e_pos.stock_transfers (from_branch_id, to_branch_id, note, item_count, total_qty, created_by)
  values (v_from, v_to, nullif(btrim(coalesce(p_note, '')), ''), v_item_count, v_total_qty, auth.uid())
  returning id, number into v_transfer_id, v_number;

  -- Urut per product_id supaya urutan kunci baris konsisten dengan penjualan dan opname.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) order by product_id
  loop
    select * into v_product from e_pos.products
     where id = v_item.product_id and deleted_at is null
     for update;
    if not found then
      raise exception 'Produk tidak ditemukan atau sudah dihapus';
    end if;
    if coalesce(v_product.is_service, false) or v_product.type = 'JASA' then
      raise exception 'Produk "%" adalah jasa dan tidak punya stok untuk dipindahkan', v_product.name;
    end if;

    select * into v_src from e_pos.product_branches
     where product_id = v_item.product_id and branch_id = v_from
     for update;
    if not found or v_src.stock < v_item.qty then
      raise exception 'Stok "%" di % tidak cukup. Stok %, transfer % unit.',
        v_product.name, v_from_name, coalesce(v_src.stock, 0), v_item.qty;
    end if;

    -- Tujuan otomatis dibuatkan baris (aktif) kalau produk belum pernah ada di sana.
    insert into e_pos.product_branches (product_id, branch_id, stock, min_stock, is_active)
    values (v_item.product_id, v_to, 0, v_src.min_stock, true)
    on conflict (product_id, branch_id) do nothing;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      v_item.product_id, 'transfer_out', -v_item.qty, v_transfer_id,
      'Transfer #' || v_number || ' ke ' || v_to_name,
      auth.uid(), v_from
    )
    returning id into v_out_id;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      v_item.product_id, 'transfer_in', v_item.qty, v_transfer_id,
      'Transfer #' || v_number || ' dari ' || v_from_name,
      auth.uid(), v_to
    )
    returning id into v_in_id;

    insert into e_pos.stock_transfer_items
      (transfer_id, product_id, product_name, product_sku, product_unit, qty, out_movement_id, in_movement_id)
    values
      (v_transfer_id, v_item.product_id, v_product.name, v_product.sku, v_product.unit,
       v_item.qty, v_out_id, v_in_id);
  end loop;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'stock_transfer', 'stock_transfer', v_transfer_id,
    jsonb_build_object(
      'transfer_number', v_number,
      'from_branch', v_from_name,
      'to_branch', v_to_name,
      'item_count', v_item_count,
      'total_qty', v_total_qty,
      'note', format('Transfer #%s: %s ke %s, %s produk, %s unit',
                     v_number, v_from_name, v_to_name, v_item_count, v_total_qty)
    )
  );

  return jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'number', v_number,
    'item_count', v_item_count,
    'total_qty', v_total_qty
  );
end;
$$;

-- Patch RPC stok yang sudah ada.
-- Dikerjakan atas definisi yang LIVE di database (bukan salinan dari file), dengan
-- potongan teks yang harus ketemu tepat satu kali. Kalau tidak ketemu, migration
-- berhenti dengan pesan yang menyebut fungsinya dan seluruh perubahan dibatalkan.
-- Fungsi yang sudah memuat product_branches dilewati, jadi aman dijalankan ulang.

create or replace function pg_temp.patch_fn(p_sig text, p_edits jsonb, p_drop_old boolean)
returns void
language plpgsql
as $f$
declare
  v_oid oid := to_regprocedure(p_sig);
  v_def text;
  v_edit jsonb;
  v_old text;
  v_count integer;
begin
  if v_oid is null then
    return;
  end if;

  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  if position('product_branches' in v_def) > 0 then
    return;
  end if;

  for v_edit in select * from jsonb_array_elements(p_edits) loop
    v_old := replace(v_edit->>'o', E'\r', '');
    v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_count <> 1 then
      raise exception 'Patch % gagal: potongan teks ditemukan % kali (harus 1): %',
        p_sig, v_count, left(v_old, 140);
    end if;
    v_def := replace(v_def, v_old, replace(v_edit->>'n', E'\r', ''));
  end loop;

  if p_drop_old then
    execute format('drop function %s', v_oid::regprocedure);
  end if;
  execute v_def;
end;
$f$;

select pg_temp.patch_fn(
  $s$e_pos.adjust_stock(uuid,text,integer,text)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text)$o$, 'n', $n$adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text, p_branch_id uuid DEFAULT NULL::uuid)$n$),
    jsonb_build_object('o', $o$    v_movement_id UUID;
begin$o$, 'n', $n$    v_movement_id UUID;
    v_branch_id UUID;
begin$n$),
    jsonb_build_object('o', $o$    v_old_stock := COALESCE(v_product.stock, 0);$o$, 'n', $n$    v_branch_id := e_pos.resolve_branch(p_branch_id);

    SELECT pb.stock INTO v_old_stock
    FROM e_pos.product_branches pb
    WHERE pb.product_id = p_product_id AND pb.branch_id = v_branch_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produk "%" belum diaktifkan di outlet ini', v_product.name;
    END IF;$n$),
    jsonb_build_object('o', $o$UPDATE products SET stock = v_new_stock, updated_at = NOW() WHERE id = p_product_id;$o$, 'n', $n$UPDATE products SET stock = COALESCE(stock, 0) + v_qty_delta, updated_at = NOW() WHERE id = p_product_id;$n$),
    jsonb_build_object('o', $o$INSERT INTO stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    VALUES (p_product_id, p_type, v_qty_delta, NULL, btrim(p_reason), auth.uid())$o$, 'n', $n$INSERT INTO stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    VALUES (p_product_id, p_type, v_qty_delta, NULL, btrim(p_reason), auth.uid(), v_branch_id)$n$),
    jsonb_build_object('o', $o$'new_stock', v_new_stock, 'movement_id', v_movement_id$o$, 'n', $n$'new_stock', v_new_stock, 'movement_id', v_movement_id, 'branch_id', v_branch_id$n$)
  ),
  true
);

select pg_temp.patch_fn(
  $s$e_pos.receive_stock(date,text,text,text,jsonb,boolean)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$p_items jsonb, p_update_cost boolean DEFAULT false)$o$, 'n', $n$p_items jsonb, p_update_cost boolean DEFAULT false, p_branch_id uuid DEFAULT NULL::uuid)$n$),
    jsonb_build_object('o', $o$  v_total_cost bigint;
begin$o$, 'n', $n$  v_total_cost bigint;
  v_branch_id uuid;
begin$n$),
    jsonb_build_object('o', $o$  if v_date > v_today then
    raise exception 'Tanggal terima tidak boleh di masa depan';$o$, 'n', $n$  v_branch_id := e_pos.resolve_branch(p_branch_id);

  if v_date > v_today then
    raise exception 'Tanggal terima tidak boleh di masa depan';$n$),
    jsonb_build_object('o', $o$(received_at, supplier, reference_no, note, item_count, total_qty, total_cost, cost_updated, created_by)$o$, 'n', $n$(received_at, supplier, reference_no, note, item_count, total_qty, total_cost, cost_updated, created_by, branch_id)$n$),
    jsonb_build_object('o', $o$v_item_count, v_total_qty, v_total_cost, coalesce(p_update_cost, false), auth.uid()
  )$o$, 'n', $n$v_item_count, v_total_qty, v_total_cost, coalesce(p_update_cost, false), auth.uid(), v_branch_id
  )$n$),
    jsonb_build_object('o', $o$    v_old := coalesce(v_product.stock, 0);

    update e_pos.products
       set stock = v_old + v_item.qty,$o$, 'n', $n$    if not exists (
      select 1 from e_pos.product_branches pb
      where pb.product_id = v_item.product_id and pb.branch_id = v_branch_id
    ) then
      raise exception 'Produk "%" belum diaktifkan di outlet ini', v_product.name;
    end if;

    v_old := coalesce(v_product.stock, 0);

    update e_pos.products
       set stock = v_old + v_item.qty,$n$),
    jsonb_build_object('o', $o$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'stock_in'$o$, 'n', $n$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      v_item.product_id, 'stock_in'$n$),
    jsonb_build_object('o', $o$coalesce(' — ' || v_supplier, ''),
      auth.uid()
    )
    returning id into v_movement_id;$o$, 'n', $n$coalesce(' — ' || v_supplier, ''),
      auth.uid(),
      v_branch_id
    )
    returning id into v_movement_id;$n$)
  ),
  true
);

select pg_temp.patch_fn(
  $s$e_pos.void_stock_receipt(uuid,text)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$    v_old := coalesce(v_product.stock, 0);

    if v_old < v_item.qty then$o$, 'n', $n$    select coalesce(pb.stock, 0) into v_old
    from e_pos.product_branches pb
    where pb.product_id = v_item.product_id and pb.branch_id = v_receipt.branch_id;
    v_old := coalesce(v_old, 0);

    if v_old < v_item.qty then$n$),
    jsonb_build_object('o', $o$update e_pos.products set stock = v_old - v_item.qty, updated_at = now()$o$, 'n', $n$update e_pos.products set stock = coalesce(stock, 0) - v_item.qty, updated_at = now()$n$),
    jsonb_build_object('o', $o$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'adjustment', -v_item.qty, null,$o$, 'n', $n$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      v_item.product_id, 'adjustment', -v_item.qty, null,$n$),
    jsonb_build_object('o', $o$'Pembatalan barang masuk #' || v_receipt.number || ': ' || btrim(p_reason),
      auth.uid()
    );$o$, 'n', $n$'Pembatalan barang masuk #' || v_receipt.number || ': ' || btrim(p_reason),
      auth.uid(),
      v_receipt.branch_id
    );$n$)
  ),
  false
);

select pg_temp.patch_fn(
  $s$e_pos.start_stock_opname(text,uuid,text)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$p_note text DEFAULT NULL::text)$o$, 'n', $n$p_note text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)$n$),
    jsonb_build_object('o', $o$  v_conflict bigint;
begin$o$, 'n', $n$  v_conflict bigint;
  v_branch_id uuid;
begin$n$),
    jsonb_build_object('o', $o$  if p_category_id is not null then
    select name into v_category_name$o$, 'n', $n$  v_branch_id := e_pos.resolve_branch(p_branch_id);

  if p_category_id is not null then
    select name into v_category_name$n$),
    jsonb_build_object('o', $o$  where s.status = 'draft'
    and p.deleted_at is null$o$, 'n', $n$  where s.status = 'draft'
    and s.branch_id = v_branch_id
    and p.deleted_at is null$n$),
    jsonb_build_object('o', $o$(name, category_id, category_name, note, created_by)
  values (v_name, p_category_id, v_category_name, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())$o$, 'n', $n$(name, category_id, category_name, note, created_by, branch_id)
  values (v_name, p_category_id, v_category_name, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_branch_id)$n$),
    jsonb_build_object('o', $o$p.cost_price, coalesce(p.stock, 0)
  from e_pos.products p
  where p.deleted_at is null$o$, 'n', $n$p.cost_price, coalesce(pb.stock, 0)
  from e_pos.products p
  join e_pos.product_branches pb on pb.product_id = p.id and pb.branch_id = v_branch_id
  where p.deleted_at is null$n$)
  ),
  true
);

select pg_temp.patch_fn(
  $s$e_pos.save_opname_count(uuid,uuid,text,integer,text)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$select coalesce(stock, 0) into v_stock from e_pos.products where id = p_product_id;$o$, 'n', $n$select coalesce(pb.stock, 0) into v_stock
    from e_pos.product_branches pb
    where pb.product_id = p_product_id and pb.branch_id = v_session.branch_id;$n$)
  ),
  false
);

select pg_temp.patch_fn(
  $s$e_pos.finalize_stock_opname(uuid)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$    v_old := coalesce(v_product.stock, 0);
    v_delta := v_item.counted_qty - v_item.system_qty;$o$, 'n', $n$    select coalesce(pb.stock, 0) into v_old
    from e_pos.product_branches pb
    where pb.product_id = v_item.product_id and pb.branch_id = v_session.branch_id;
    v_old := coalesce(v_old, 0);
    v_delta := v_item.counted_qty - v_item.system_qty;$n$),
    jsonb_build_object('o', $o$update e_pos.products set stock = v_new, updated_at = now() where id = v_item.product_id;$o$, 'n', $n$update e_pos.products set stock = coalesce(stock, 0) + v_delta, updated_at = now() where id = v_item.product_id;$n$),
    jsonb_build_object('o', $o$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'opname', v_delta, null,$o$, 'n', $n$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      v_item.product_id, 'opname', v_delta, null,$n$),
    jsonb_build_object('o', $o$coalesce(' — ' || v_item.note, ''),
      auth.uid()
    )$o$, 'n', $n$coalesce(' — ' || v_item.note, ''),
      auth.uid(),
      v_session.branch_id
    )$n$)
  ),
  false
);

select pg_temp.patch_fn(
  $s$e_pos.give_gift(date,text,text,text,text,jsonb)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$p_note text, p_items jsonb)$o$, 'n', $n$p_note text, p_items jsonb, p_branch_id uuid DEFAULT NULL::uuid)$n$),
    jsonb_build_object('o', $o$  v_total_retail bigint := 0;
begin$o$, 'n', $n$  v_total_retail bigint := 0;
  v_branch_id uuid;
begin$n$),
    jsonb_build_object('o', $o$  if v_recipient is null then
    raise exception 'Nama penerima wajib diisi';$o$, 'n', $n$  v_branch_id := e_pos.resolve_branch(p_branch_id);

  if v_recipient is null then
    raise exception 'Nama penerima wajib diisi';$n$),
    jsonb_build_object('o', $o$(given_at, recipient_name, recipient_category, occasion, note, item_count, total_qty, created_by)$o$, 'n', $n$(given_at, recipient_name, recipient_category, occasion, note, item_count, total_qty, created_by, branch_id)$n$),
    jsonb_build_object('o', $o$    v_item_count, v_total_qty,
    (select id from e_pos.profiles where id = auth.uid())
  )$o$, 'n', $n$    v_item_count, v_total_qty,
    (select id from e_pos.profiles where id = auth.uid()),
    v_branch_id
  )$n$),
    jsonb_build_object('o', $o$    v_old := coalesce(v_product.stock, 0);

    if v_old < v_item.qty then$o$, 'n', $n$    select coalesce(pb.stock, 0) into v_old
    from e_pos.product_branches pb
    where pb.product_id = v_item.product_id and pb.branch_id = v_branch_id;
    v_old := coalesce(v_old, 0);

    if v_old < v_item.qty then$n$),
    jsonb_build_object('o', $o$       set stock = v_old - v_item.qty,$o$, 'n', $n$       set stock = coalesce(stock, 0) - v_item.qty,$n$),
    jsonb_build_object('o', $o$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'gift', -v_item.qty, v_gift_id,$o$, 'n', $n$insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by, branch_id)
    values (
      v_item.product_id, 'gift', -v_item.qty, v_gift_id,$n$),
    jsonb_build_object('o', $o$coalesce(' (' || v_occasion || ')', ''),
      (select id from e_pos.profiles where id = auth.uid())
    )
    returning id into v_movement_id;$o$, 'n', $n$coalesce(' (' || v_occasion || ')', ''),
      (select id from e_pos.profiles where id = auth.uid()),
      v_branch_id
    )
    returning id into v_movement_id;$n$)
  ),
  true
);

select pg_temp.patch_fn(
  $s$e_pos.stock_movement_summary(timestamp with time zone,timestamp with time zone,uuid,text[],uuid)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$p_types text[] DEFAULT NULL::text[], p_user_id uuid DEFAULT NULL::uuid)$o$, 'n', $n$p_types text[] DEFAULT NULL::text[], p_user_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)$n$),
    jsonb_build_object('o', $o$    and (p_user_id is null or created_by = p_user_id)$o$, 'n', $n$    and (p_user_id is null or created_by = p_user_id)
    and (p_branch_id is null or branch_id = p_branch_id)$n$)
  ),
  true
);

select pg_temp.patch_fn(
  $s$e_pos.delete_branch(uuid)$s$,
  jsonb_build_array(
    jsonb_build_object('o', $o$  if v_blocker is not null then
    raise exception 'Outlet ini sudah punya riwayat (%) sehingga tidak bisa dihapus. Nonaktifkan saja.', v_blocker;$o$, 'n', $n$  if v_blocker is null then
    select count(*) into v_n from e_pos.stock_movements where branch_id = p_branch_id;
    if v_n > 0 then v_blocker := format('%s mutasi stok', v_n); end if;
  end if;

  if v_blocker is null then
    select count(*) into v_n from e_pos.stock_transfers
     where from_branch_id = p_branch_id or to_branch_id = p_branch_id;
    if v_n > 0 then v_blocker := format('%s transfer stok', v_n); end if;
  end if;

  if v_blocker is null then
    select count(*) into v_n from (
      select 1 from e_pos.stock_receipts where branch_id = p_branch_id
      union all select 1 from e_pos.stock_opname_sessions where branch_id = p_branch_id
      union all select 1 from e_pos.gift_records where branch_id = p_branch_id
    ) docs;
    if v_n > 0 then v_blocker := format('%s dokumen stok', v_n); end if;
  end if;

  if v_blocker is null then
    select count(*) into v_n from e_pos.product_branches
     where branch_id = p_branch_id and stock > 0;
    if v_n > 0 then v_blocker := format('%s produk masih punya stok', v_n); end if;
  end if;

  if v_blocker is not null then
    raise exception 'Outlet ini sudah punya riwayat (%) sehingga tidak bisa dihapus. Nonaktifkan saja.', v_blocker;$n$),
    jsonb_build_object('o', $o$  delete from e_pos.branches where id = p_branch_id;$o$, 'n', $n$  delete from e_pos.product_branches where branch_id = p_branch_id;

  delete from e_pos.branches where id = p_branch_id;$n$)
  ),
  false
);

revoke all on function e_pos.adjust_stock(uuid, text, integer, text, uuid) from public, anon;
grant execute on function e_pos.adjust_stock(uuid, text, integer, text, uuid) to authenticated, service_role;
revoke all on function e_pos.receive_stock(date, text, text, text, jsonb, boolean, uuid) from public, anon;
grant execute on function e_pos.receive_stock(date, text, text, text, jsonb, boolean, uuid) to authenticated, service_role;
revoke all on function e_pos.start_stock_opname(text, uuid, text, uuid) from public, anon;
grant execute on function e_pos.start_stock_opname(text, uuid, text, uuid) to authenticated, service_role;
revoke all on function e_pos.give_gift(date, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function e_pos.give_gift(date, text, text, text, text, jsonb, uuid) to authenticated, service_role;
revoke all on function e_pos.stock_movement_summary(timestamp with time zone, timestamp with time zone, uuid, text[], uuid, uuid) from public, anon;
grant execute on function e_pos.stock_movement_summary(timestamp with time zone, timestamp with time zone, uuid, text[], uuid, uuid) to authenticated, service_role;

-- Fungsi baru: hanya untuk user login

revoke all on function e_pos.resolve_branch(uuid) from public, anon;
grant execute on function e_pos.resolve_branch(uuid) to authenticated, service_role;

revoke all on function e_pos.assign_product_branch(uuid, uuid, integer, integer, bigint, text) from public, anon;
grant execute on function e_pos.assign_product_branch(uuid, uuid, integer, integer, bigint, text) to authenticated, service_role;

revoke all on function e_pos.bulk_assign_product_branch(uuid, uuid[]) from public, anon;
grant execute on function e_pos.bulk_assign_product_branch(uuid, uuid[]) to authenticated, service_role;

revoke all on function e_pos.update_product_branch(uuid, uuid, boolean, integer, bigint, boolean) from public, anon;
grant execute on function e_pos.update_product_branch(uuid, uuid, boolean, integer, bigint, boolean) to authenticated, service_role;

revoke all on function e_pos.transfer_stock(uuid, uuid, jsonb, text) from public, anon;
grant execute on function e_pos.transfer_stock(uuid, uuid, jsonb, text) to authenticated, service_role;

-- Kontrol konsistensi: baris di hasil query ini = produk yang total stok outlet-nya
-- tidak sama dengan products.stock. Harus kosong.
--
--   select p.id, p.name, p.stock, coalesce(sum(pb.stock), 0) as total_outlet
--     from e_pos.products p
--     left join e_pos.product_branches pb on pb.product_id = p.id
--    where coalesce(p.is_service, false) = false and p.type <> 'JASA'
--    group by p.id
--   having coalesce(p.stock, 0) <> coalesce(sum(pb.stock), 0);

commit;
