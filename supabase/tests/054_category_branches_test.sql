-- Tes migration 054. Jalankan di SQL Editor Supabase SETELAH migration 054.
-- Semua perubahan di-rollback di akhir. Butuh Super Admin aktif dan satu outlet pusat.

begin;

set local search_path = e_pos, public;

do $$
declare
  v_uid uuid;
  v_pusat uuid;
  v_c1 uuid;
  v_c2 uuid;
  v_cat uuid;
  v_count integer;
begin
  select id into v_uid from e_pos.profiles where is_active and 'super_admin' = any(roles) limit 1;
  if v_uid is null then raise exception 'TES GAGAL: tidak ada Super Admin aktif'; end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  v_pusat := e_pos.pusat_branch_id();
  if v_pusat is null then raise exception 'TES GAGAL: belum ada outlet pusat'; end if;
  insert into e_pos.branches (name, code, sort_order, branch_type) values ('TES K1', 'TK1', 9998, 'cabang') returning id into v_c1;
  insert into e_pos.branches (name, code, sort_order, branch_type) values ('TES K2', 'TK2', 9999, 'cabang') returning id into v_c2;

  -- 1. Dibuat di pusat: hanya di pusat
  v_cat := e_pos.create_category('TES Kategori Pusat', 0, true, v_pusat);
  select count(*) into v_count from e_pos.category_branches where category_id = v_cat;
  if v_count <> 1 then raise exception 'TES GAGAL: kategori pusat terpasang di % outlet, seharusnya 1', v_count; end if;

  -- 2. Dipasang ke cabang 1 dari pusat
  perform e_pos.set_category_branch(v_cat, v_c1, true);
  select count(*) into v_count from e_pos.category_branches where category_id = v_cat and branch_id = v_c1;
  if v_count <> 1 then raise exception 'TES GAGAL: kategori tidak terpasang di cabang 1'; end if;
  select count(*) into v_count from e_pos.category_branches where category_id = v_cat and branch_id = v_c2;
  if v_count <> 0 then raise exception 'TES GAGAL: kategori muncul di cabang 2'; end if;

  -- 3. Dilepas dari cabang 1
  perform e_pos.set_category_branch(v_cat, v_c1, false);
  select count(*) into v_count from e_pos.category_branches where category_id = v_cat and branch_id = v_c1;
  if v_count <> 0 then raise exception 'TES GAGAL: kategori masih terpasang di cabang 1'; end if;

  -- 4. Dibuat di cabang: tidak ada di pusat
  v_cat := e_pos.create_category('TES Kategori Cabang', 0, true, v_c2);
  select count(*) into v_count from e_pos.category_branches where category_id = v_cat and branch_id = v_pusat;
  if v_count <> 0 then raise exception 'TES GAGAL: kategori buatan cabang muncul di pusat'; end if;

  raise notice 'TES 054 LULUS';
end $$;

rollback;
