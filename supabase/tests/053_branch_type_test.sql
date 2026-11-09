-- Tes migration 053. Jalankan di SQL Editor Supabase SETELAH migration 053.
-- Semua perubahan di-rollback di akhir, jadi data asli aman.
-- Butuh minimal satu Super Admin aktif dan minimal satu outlet berjenis pusat.
-- Setiap pemeriksaan gagal memunculkan exception "TES GAGAL: ...".

begin;

set local search_path = e_pos, public;

do $$
declare
  v_uid uuid;
  v_pusat uuid;
  v_cabang uuid;
  v_cabang2 uuid;
  v_product uuid;
  v_failed boolean;
  v_count integer;
begin
  select id into v_uid from e_pos.profiles
   where is_active and 'super_admin' = any(roles) limit 1;
  if v_uid is null then
    raise exception 'TES GAGAL: tidak ada Super Admin aktif untuk menjalankan tes';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  v_pusat := e_pos.pusat_branch_id();
  if v_pusat is null then
    raise exception 'TES GAGAL: belum ada outlet pusat';
  end if;

  insert into e_pos.branches (name, code, sort_order, branch_type) values ('TES Cabang 1', 'TC1', 9998, 'cabang') returning id into v_cabang;
  insert into e_pos.branches (name, code, sort_order, branch_type) values ('TES Cabang 2', 'TC2', 9999, 'cabang') returning id into v_cabang2;

  -- 1. Pusat kedua ditolak (unique index)
  v_failed := false;
  begin
    update e_pos.branches set branch_type = 'pusat' where id = v_cabang;
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: pusat kedua seharusnya ditolak'; end if;

  -- 2. Jenis di luar pusat/cabang ditolak
  v_failed := false;
  begin
    update e_pos.branches set branch_type = 'ranting' where id = v_cabang;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: jenis outlet tidak valid seharusnya ditolak'; end if;

  -- 3. Pusat tidak bisa dinonaktifkan
  v_failed := false;
  begin
    update e_pos.branches set is_active = false where id = v_pusat;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: menonaktifkan pusat seharusnya ditolak'; end if;

  -- 4. Pusat tidak bisa dihapus
  v_failed := false;
  begin
    delete from e_pos.branches where id = v_pusat;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: menghapus pusat seharusnya ditolak'; end if;

  -- 5. Produk dibuat di pusat: cabang tidak ikut
  insert into e_pos.products (sku, name, type, sell_price, stock, min_stock)
  values ('TES-053-A', 'Produk Tes 053', 'MERCHANDISE', 10000, 0, 1) returning id into v_product;
  perform e_pos.assign_product_branch(v_product, v_pusat, 0, 1, null, null);
  select count(*) into v_count from e_pos.product_branches
   where product_id = v_product and branch_id <> v_pusat;
  if v_count <> 0 then raise exception 'TES GAGAL: produk baru muncul di % cabang, seharusnya 0', v_count; end if;

  -- 6. Dari pusat, produk bisa dipasang ke cabang 1, cabang 2 tetap tidak punya
  perform e_pos.assign_product_branch(v_product, v_cabang, 0, 1, null, null);
  select count(*) into v_count from e_pos.product_branches
   where product_id = v_product and branch_id = v_cabang and is_active;
  if v_count <> 1 then raise exception 'TES GAGAL: produk tidak terpasang di cabang 1'; end if;
  select count(*) into v_count from e_pos.product_branches
   where product_id = v_product and branch_id = v_cabang2;
  if v_count <> 0 then raise exception 'TES GAGAL: produk muncul di cabang 2'; end if;

  -- 7. Produk dibuat di cabang: hanya terpasang di cabang itu, tidak di pusat
  insert into e_pos.products (sku, name, type, sell_price, stock, min_stock)
  values ('TES-053-B', 'Produk Tes 053 B', 'MERCHANDISE', 10000, 0, 0) returning id into v_product;
  perform e_pos.assign_product_branch(v_product, v_cabang2, 0, 0, null, null);
  select count(*) into v_count from e_pos.product_branches
   where product_id = v_product and branch_id = v_pusat;
  if v_count <> 0 then raise exception 'TES GAGAL: produk buatan cabang muncul di pusat'; end if;

  raise notice 'TES 053 LULUS';
end $$;

rollback;
