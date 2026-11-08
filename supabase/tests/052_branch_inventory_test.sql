-- Tes migration 052. Jalankan di SQL Editor Supabase SETELAH migration 052.
-- Semua perubahan di-rollback di akhir, jadi data asli aman.
-- Butuh minimal satu Super Admin aktif dan minimal satu outlet aktif.
-- Setiap pemeriksaan gagal memunculkan exception "TES GAGAL: ...".

begin;

set local search_path = e_pos, public;

do $$
declare
  v_uid uuid;
  v_a uuid;
  v_b uuid;
  v_product uuid;
  v_service uuid;
  v_stock integer;
  v_total integer;
  v_res jsonb;
  v_failed boolean;
begin
  select id into v_uid from e_pos.profiles
   where is_active and 'super_admin' = any(roles) limit 1;
  if v_uid is null then
    raise exception 'TES GAGAL: tidak ada Super Admin aktif untuk menjalankan tes';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select id into v_a from e_pos.branches where is_active order by sort_order, created_at limit 1;
  insert into e_pos.branches (name, code, sort_order) values ('TES Outlet B', 'TESB', 9999) returning id into v_b;

  insert into e_pos.products (sku, name, type, sell_price, stock, min_stock)
  values ('TES-052-A', 'Produk Tes 052', 'MERCHANDISE', 10000, 0, 2) returning id into v_product;
  insert into e_pos.products (sku, name, type, is_service, sell_price)
  values ('TES-052-J', 'Jasa Tes 052', 'JASA', true, 5000) returning id into v_service;

  -- 1. Aktifkan di outlet A dengan stok awal 10
  perform e_pos.assign_product_branch(v_product, v_a, 10, 2, null, null);
  select stock into v_stock from e_pos.product_branches where product_id = v_product and branch_id = v_a;
  if v_stock <> 10 then raise exception 'TES GAGAL: stok awal outlet A = %, seharusnya 10', v_stock; end if;
  select stock into v_total from e_pos.products where id = v_product;
  if v_total <> 10 then raise exception 'TES GAGAL: products.stock = %, seharusnya 10', v_total; end if;

  -- 2. Stok awal kedua kali di outlet yang sama ditolak
  v_failed := false;
  begin
    perform e_pos.assign_product_branch(v_product, v_a, 5, null, null, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: stok awal ganda seharusnya ditolak'; end if;

  -- 3. Barang masuk di outlet A
  perform e_pos.receive_stock(current_date, 'Supplier Tes', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 5)), false, v_a);
  select stock into v_stock from e_pos.product_branches where product_id = v_product and branch_id = v_a;
  if v_stock <> 15 then raise exception 'TES GAGAL: setelah barang masuk stok A = %, seharusnya 15', v_stock; end if;

  -- 4. Barang masuk di outlet B yang belum aktif ditolak
  v_failed := false;
  begin
    perform e_pos.receive_stock(current_date, null, null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 1)), false, v_b);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: barang masuk ke outlet belum aktif seharusnya ditolak'; end if;

  -- 5. Transfer 6 unit A -> B (B otomatis aktif)
  perform e_pos.transfer_stock(v_a, v_b,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 6)), 'tes');
  select stock into v_stock from e_pos.product_branches where product_id = v_product and branch_id = v_a;
  if v_stock <> 9 then raise exception 'TES GAGAL: stok A sesudah transfer = %, seharusnya 9', v_stock; end if;
  select stock into v_stock from e_pos.product_branches where product_id = v_product and branch_id = v_b;
  if v_stock <> 6 then raise exception 'TES GAGAL: stok B sesudah transfer = %, seharusnya 6', v_stock; end if;
  select stock into v_total from e_pos.products where id = v_product;
  if v_total <> 15 then raise exception 'TES GAGAL: total stok berubah karena transfer (%), seharusnya 15', v_total; end if;

  -- 6. Transfer melebihi stok ditolak dan tidak mengubah apa pun
  v_failed := false;
  begin
    perform e_pos.transfer_stock(v_a, v_b,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 100)), null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: transfer melebihi stok seharusnya ditolak'; end if;

  -- 7. Mutasi negatif melebihi stok outlet ditolak walau total semua outlet cukup
  v_failed := false;
  begin
    insert into e_pos.stock_movements (product_id, type, qty_delta, reason, created_by, branch_id)
    values (v_product, 'sale', -7, null, v_uid, v_b);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: stok minus per outlet seharusnya ditolak'; end if;

  -- 8. Opname outlet B: hitung fisik 4, stok B jadi 4, stok A tidak berubah
  perform e_pos.adjust_stock(v_product, 'opname', 4, 'tes opname', v_b);
  select stock into v_stock from e_pos.product_branches where product_id = v_product and branch_id = v_b;
  if v_stock <> 4 then raise exception 'TES GAGAL: stok B sesudah opname = %, seharusnya 4', v_stock; end if;
  select stock into v_stock from e_pos.product_branches where product_id = v_product and branch_id = v_a;
  if v_stock <> 9 then raise exception 'TES GAGAL: stok A ikut berubah (%), seharusnya 9', v_stock; end if;
  select stock into v_total from e_pos.products where id = v_product;
  if v_total <> 13 then raise exception 'TES GAGAL: total stok = %, seharusnya 13', v_total; end if;

  -- 9. adjust_stock tanpa outlet ditolak
  v_failed := false;
  begin
    perform e_pos.adjust_stock(v_product, 'adjustment', 1, 'tes', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'TES GAGAL: adjust_stock tanpa outlet seharusnya ditolak'; end if;

  -- 10. Harga khusus outlet dan nonaktif di outlet
  perform e_pos.update_product_branch(v_product, v_b, false, null, 12000, false);
  if not exists (select 1 from e_pos.product_branches
                  where product_id = v_product and branch_id = v_b
                    and is_active = false and price_override = 12000) then
    raise exception 'TES GAGAL: update_product_branch tidak menyimpan harga/status';
  end if;
  perform e_pos.update_product_branch(v_product, v_b, true, null, null, true);
  if exists (select 1 from e_pos.product_branches
              where product_id = v_product and branch_id = v_b and price_override is not null) then
    raise exception 'TES GAGAL: harga khusus seharusnya terhapus';
  end if;

  -- 11. Produk jasa aktif lewat bulk assign, tanpa stok
  v_res := e_pos.bulk_assign_product_branch(v_b, array[v_service]);
  if not exists (select 1 from e_pos.product_branches
                  where product_id = v_service and branch_id = v_b and stock = 0) then
    raise exception 'TES GAGAL: bulk assign jasa gagal';
  end if;

  -- 12. Kartu stok memakai saldo per outlet (tidak negatif dan sesuai stok sekarang)
  if (select stock_after from e_pos.stock_ledger
       where product_id = v_product and branch_id = v_b
       order by created_at desc, id desc limit 1) <> 4 then
    raise exception 'TES GAGAL: saldo terakhir kartu stok outlet B bukan 4';
  end if;

  -- 13. Total stok semua produk tes konsisten
  if exists (
    select 1 from e_pos.products p
    left join e_pos.product_branches pb on pb.product_id = p.id
    where p.id = v_product
    group by p.id having coalesce(p.stock, 0) <> coalesce(sum(pb.stock), 0)
  ) then
    raise exception 'TES GAGAL: products.stock tidak sama dengan jumlah stok outlet';
  end if;

  raise notice 'SEMUA TES 052 LULUS';
end $$;

rollback;
