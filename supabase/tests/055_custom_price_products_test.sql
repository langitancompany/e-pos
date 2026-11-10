-- Tes migration 055. Jalankan di SQL Editor Supabase SETELAH migration 055.
-- Semua perubahan di-rollback di akhir. Dijalankan tanpa login (auth.uid() kosong),
-- jadi create_transaction tidak meminta shift kasir terbuka.

begin;

set local search_path = e_pos, public;

do $$
declare
  v_prod uuid;
  v_plain uuid;
  v_result jsonb;
  v_name text;
  v_ok boolean;

  -- Satu item harga bebas dengan nilai yang bisa diubah per kasus.
  v_call_desc text;
  v_call_price bigint;
begin
  insert into e_pos.products (sku, name, type, is_service, sell_price, is_custom_price, min_price)
  values ('TES-HB-1', 'TES Cetak Custom', 'JASA', true, 10000, true, 5000)
  returning id into v_prod;

  insert into e_pos.products (sku, name, type, is_service, sell_price)
  values ('TES-HB-2', 'TES Jasa Biasa', 'JASA', true, 3000)
  returning id into v_plain;

  -- 1. Produk non JASA tidak boleh harga bebas
  v_ok := false;
  begin
    insert into e_pos.products (sku, name, type, is_service, sell_price, is_custom_price)
    values ('TES-HB-3', 'TES Fisik', 'FASHION', false, 1000, true);
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TES GAGAL: produk non JASA lolos sebagai harga bebas'; end if;

  -- 2. Tanpa deskripsi ditolak
  v_ok := false;
  begin
    perform e_pos.create_transaction(
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'qty', 1, 'unit_price', 8000, 'discount', 0, 'subtotal', 8000)),
      p_subtotal := 8000, p_total := 8000,
      p_payment_method := 'CASH', p_payment_amount := 8000, p_received_amount := 8000);
  exception when raise_exception then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TES GAGAL: item harga bebas tanpa deskripsi lolos'; end if;

  -- 3. Harga di bawah minimum ditolak
  v_ok := false;
  begin
    perform e_pos.create_transaction(
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'qty', 1, 'unit_price', 4000, 'discount', 0, 'subtotal', 4000,
        'description', 'Terlalu murah')),
      p_subtotal := 4000, p_total := 4000,
      p_payment_method := 'CASH', p_payment_amount := 4000, p_received_amount := 4000);
  exception when raise_exception then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TES GAGAL: harga di bawah minimum lolos'; end if;

  -- 4. Harga 0 ditolak
  v_ok := false;
  begin
    perform e_pos.create_transaction(
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'qty', 1, 'unit_price', 0, 'discount', 0, 'subtotal', 0,
        'description', 'Gratis')),
      p_subtotal := 0, p_total := 0,
      p_payment_method := 'CASH', p_payment_amount := 0, p_received_amount := 0);
  exception when raise_exception then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TES GAGAL: harga 0 lolos'; end if;

  -- 5. Item valid: nama menjadi "Nama: deskripsi", harga dan jumlah tersimpan
  v_call_desc := 'Undangan 100 lembar';
  v_call_price := 7500;
  v_result := e_pos.create_transaction(
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'qty', 2, 'unit_price', v_call_price, 'discount', 0,
      'subtotal', v_call_price * 2, 'description', v_call_desc)),
    p_subtotal := v_call_price * 2, p_total := v_call_price * 2,
    p_payment_method := 'CASH', p_payment_amount := v_call_price * 2,
    p_received_amount := v_call_price * 2);

  select product_name into v_name
    from e_pos.transaction_items
   where transaction_id = (v_result->>'transaction_id')::uuid;
  if v_name is distinct from 'TES Cetak Custom: Undangan 100 lembar' then
    raise exception 'TES GAGAL: nama item = %, seharusnya "TES Cetak Custom: Undangan 100 lembar"', v_name;
  end if;

  if not exists (
    select 1 from e_pos.transaction_items
     where transaction_id = (v_result->>'transaction_id')::uuid
       and unit_price = 7500 and qty = 2 and subtotal = 15000
  ) then
    raise exception 'TES GAGAL: harga atau jumlah item tidak sesuai';
  end if;

  -- 6. Produk biasa tidak berubah: nama tetap nama produk, deskripsi diabaikan
  v_result := e_pos.create_transaction(
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_plain, 'qty', 1, 'unit_price', 3000, 'discount', 0, 'subtotal', 3000,
      'description', 'harus diabaikan')),
    p_subtotal := 3000, p_total := 3000,
    p_payment_method := 'CASH', p_payment_amount := 3000, p_received_amount := 3000);

  select product_name into v_name
    from e_pos.transaction_items
   where transaction_id = (v_result->>'transaction_id')::uuid;
  if v_name is distinct from 'TES Jasa Biasa' then
    raise exception 'TES GAGAL: nama produk biasa berubah menjadi %', v_name;
  end if;

  raise notice 'TES 055 LULUS';
end $$;

rollback;
