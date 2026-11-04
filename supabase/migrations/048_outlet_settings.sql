-- Migration 048: Pengaturan per outlet (halaman Pengaturan > Outlet)
--
-- Target schema: e_pos. Aman dijalankan ulang (idempotent). WAJIB setelah 047.
--
-- Isi:
--   1. Kolom pengaturan di `branches`: zona waktu, PPN, service charge,
--      pembulatan, program poin member, lebar kertas struk, auto-cetak,
--      header & footer struk.
--      Outlet YANG SUDAH ADA di-backfill dari pengaturan global (`settings`)
--      dan aturan poin lama (10.000 = 1 poin, 1 poin = Rp 100), jadi perilaku
--      kasir tidak berubah sebelum Anda mengubahnya sendiri.
--   2. Aturan poin sekarang PER OUTLET. `create_transaction` sebelumnya
--      memakai fungsi tetap `loyalty_earn_unit()` dan `loyalty_point_value()`.
--      Di sini kedua pemanggilan itu diganti ke versi `_for_user()` yang
--      membaca outlet dari shift kasir yang sedang terbuka. Penggantian
--      dilakukan atas definisi fungsi yang LIVE di database (bukan salinan
--      dari file), jadi aman walau isi function di production sudah berbeda
--      dari schema_e_pos.sql. Kalau teks yang dicari tidak ditemukan,
--      function tidak diubah dan muncul NOTICE.
--
-- BELUM DITERAPKAN KE TRANSAKSI (disimpan saja, lihat catatan penyerahan):
--   service charge dan pembulatan total. Keduanya tersimpan per outlet tetapi
--   belum mengubah total kasir/struk, karena butuh kolom baru di
--   `transactions` + perubahan RPC supaya laporan tetap cocok.

set search_path = e_pos, public;

-- --------------------------------------------------------
-- 1. Kolom pengaturan + backfill (hanya saat kolom baru ditambahkan)
-- --------------------------------------------------------

do $$
declare
  v_first_run boolean;
  v_ppn_enabled boolean;
  v_ppn_rate numeric;
  v_paper text;
  v_footer text;
  v_earn integer;
  v_value integer;
begin
  select not exists (
    select 1 from information_schema.columns
     where table_schema = 'e_pos' and table_name = 'branches' and column_name = 'loyalty_enabled'
  ) into v_first_run;

  alter table e_pos.branches
    add column if not exists timezone                text    not null default 'Asia/Jakarta',
    add column if not exists ppn_enabled             boolean not null default false,
    add column if not exists ppn_rate                numeric(5,2) not null default 11,
    add column if not exists service_charge_enabled  boolean not null default false,
    add column if not exists service_charge_rate     numeric(5,2) not null default 0,
    add column if not exists rounding_step           integer not null default 0,
    add column if not exists loyalty_enabled         boolean not null default false,
    add column if not exists loyalty_spend_per_point integer not null default 1000,
    add column if not exists loyalty_point_value     integer not null default 1,
    add column if not exists paper_thermal           text    not null default '80mm',
    add column if not exists auto_print              boolean not null default true,
    add column if not exists receipt_header          text,
    add column if not exists receipt_footer          text;

  if v_first_run then
    select (value #>> '{}')::boolean into v_ppn_enabled from e_pos.settings where key = 'ppn_enabled';
    select (value #>> '{}')::numeric into v_ppn_rate    from e_pos.settings where key = 'ppn_rate';
    select value #>> '{}'            into v_paper       from e_pos.settings where key = 'paper_thermal';
    select value #>> '{}'            into v_footer      from e_pos.settings where key = 'footer_struk';
    v_earn  := e_pos.loyalty_earn_unit();
    v_value := e_pos.loyalty_point_value();

    update e_pos.branches set
      ppn_enabled             = coalesce(v_ppn_enabled, false),
      ppn_rate                = coalesce(v_ppn_rate, 11),
      paper_thermal           = case when v_paper in ('58mm', '80mm') then v_paper else '80mm' end,
      receipt_footer          = nullif(btrim(coalesce(v_footer, '')), ''),
      loyalty_enabled         = true,
      loyalty_spend_per_point = greatest(coalesce(v_earn, 10000), 1),
      loyalty_point_value     = greatest(coalesce(v_value, 100), 1);
  end if;
end $$;

alter table e_pos.branches drop constraint if exists branches_ppn_rate_range;
alter table e_pos.branches add constraint branches_ppn_rate_range
  check (ppn_rate >= 0 and ppn_rate <= 100);

alter table e_pos.branches drop constraint if exists branches_service_rate_range;
alter table e_pos.branches add constraint branches_service_rate_range
  check (service_charge_rate >= 0 and service_charge_rate <= 100);

alter table e_pos.branches drop constraint if exists branches_rounding_step_valid;
alter table e_pos.branches add constraint branches_rounding_step_valid
  check (rounding_step in (0, 100, 500, 1000));

alter table e_pos.branches drop constraint if exists branches_loyalty_values_positive;
alter table e_pos.branches add constraint branches_loyalty_values_positive
  check (loyalty_spend_per_point >= 1 and loyalty_point_value >= 1);

alter table e_pos.branches drop constraint if exists branches_paper_valid;
alter table e_pos.branches add constraint branches_paper_valid
  check (paper_thermal in ('58mm', '80mm'));

-- --------------------------------------------------------
-- 2. Aturan poin per outlet
-- --------------------------------------------------------

-- Outlet dari shift kasir yang sedang terbuka (null kalau tidak ada shift).
create or replace function e_pos.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path to 'e_pos'
as $$
  select s.branch_id
    from e_pos.shift_sessions s
   where s.cashier_id = auth.uid() and s.status = 'OPEN'
   limit 1;
$$;

-- Kelipatan belanja untuk 1 poin. Program poin nonaktif -> nilai sangat besar,
-- sehingga poin yang didapat selalu 0. Tanpa outlet -> aturan lama.
create or replace function e_pos.loyalty_earn_unit_for_user()
returns integer
language sql
stable
security definer
set search_path to 'e_pos'
as $$
  select case
           when b.id is null then e_pos.loyalty_earn_unit()
           when not b.loyalty_enabled then 2147483647
           else greatest(b.loyalty_spend_per_point, 1)
         end
    from (select e_pos.current_branch_id() as bid) x
    left join e_pos.branches b on b.id = x.bid;
$$;

-- Nilai rupiah 1 poin saat ditukar. Program poin nonaktif -> nilai sangat besar,
-- sehingga penukaran poin ditolak server. Tanpa outlet -> aturan lama.
create or replace function e_pos.loyalty_point_value_for_user()
returns integer
language sql
stable
security definer
set search_path to 'e_pos'
as $$
  select case
           when b.id is null then e_pos.loyalty_point_value()
           when not b.loyalty_enabled then 2147483647
           else greatest(b.loyalty_point_value, 1)
         end
    from (select e_pos.current_branch_id() as bid) x
    left join e_pos.branches b on b.id = x.bid;
$$;

-- Ganti pemanggilan fungsi tetap di create_transaction (definisi LIVE).
-- Pola 'loyalty_earn_unit()' tidak cocok dengan 'loyalty_earn_unit_for_user()',
-- jadi aman dijalankan berulang.
do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_patched integer := 0;
begin
  for v_oid in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'e_pos' and p.proname = 'create_transaction'
  loop
    v_def := pg_get_functiondef(v_oid);
    v_new := replace(v_def, 'loyalty_earn_unit()', 'loyalty_earn_unit_for_user()');
    v_new := replace(v_new, 'loyalty_point_value()', 'loyalty_point_value_for_user()');
    if v_new <> v_def then
      execute v_new;
      v_patched := v_patched + 1;
    end if;
  end loop;

  if v_patched = 0 then
    raise notice 'create_transaction tidak diubah (sudah per outlet, atau teks yang dicari tidak ditemukan). Cek manual bila poin tidak mengikuti outlet.';
  end if;
end $$;

comment on column e_pos.branches.rounding_step is
  'Pembulatan total belanja: 0 = tidak dibulatkan, selain itu kelipatan rupiah. Migration 048. Belum diterapkan ke kasir.';
comment on column e_pos.branches.service_charge_rate is
  'Persentase service charge. Migration 048. Belum diterapkan ke kasir.';
