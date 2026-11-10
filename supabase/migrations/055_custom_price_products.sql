-- Migration 055: Produk Jasa berharga bebas (harga diisi kasir saat transaksi)
--
-- Target schema: e_pos. WAJIB setelah 054. Aman dijalankan ulang. Satu transaksi.
--
-- Untuk jasa yang harganya tidak bisa dibakukan di katalog (cetak undangan, spanduk,
-- pesanan khusus). Produk ditandai is_custom_price. Saat dijual, kasir mengisi
-- deskripsi pesanan dan harga satuan. Aturan yang dijaga server:
--   * hanya produk berjenis JASA yang boleh ditandai harga bebas
--   * item harga bebas wajib punya deskripsi dan harga lebih dari 0
--   * harga tidak boleh di bawah min_price (kalau diisi)
--   * nama item di transaksi menjadi "Nama Produk: deskripsi", jadi struk, riwayat,
--     retur, dan cek struk menampilkan pesanan apa adanya tanpa perubahan lain
--
-- create_transaction diubah lewat penggantian teks pada definisi LIVE (pola migration
-- 048), karena fungsinya panjang dan sudah beberapa kali diubah. Kalau teks yang
-- dicari tidak ditemukan, migration berhenti dengan error dan tidak ada yang berubah.
-- create_transaction_digital memanggil create_transaction, jadi ikut tercakup.

begin;

set local search_path = e_pos, public;

alter table e_pos.products
  add column if not exists is_custom_price boolean not null default false,
  add column if not exists min_price bigint;

alter table e_pos.products drop constraint if exists products_custom_price_jasa_check;
alter table e_pos.products add constraint products_custom_price_jasa_check
  check (not is_custom_price or type = 'JASA');

alter table e_pos.products drop constraint if exists products_min_price_check;
alter table e_pos.products add constraint products_min_price_check
  check (min_price is null or min_price >= 0);

comment on column e_pos.products.is_custom_price is
  'Harga diisi kasir saat transaksi. Hanya untuk produk JASA. sell_price menjadi harga acuan. Migration 055.';
comment on column e_pos.products.min_price is
  'Harga satuan terendah yang boleh diisi kasir untuk produk harga bebas. Kosong = tanpa batas bawah. Migration 055.';

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_patched integer := 0;
  v_check text := $check$
        v_item_name := v_product.name;
        IF COALESCE(v_product.is_custom_price, FALSE) THEN
            v_item_desc := NULLIF(btrim(COALESCE(v_item->>'description', '')), '');
            IF v_item_desc IS NULL THEN
                RAISE EXCEPTION 'Produk "%" butuh deskripsi pesanan', v_product.name;
            END IF;
            IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
                RAISE EXCEPTION 'Harga untuk "%" harus lebih dari 0', v_product.name;
            END IF;
            IF v_product.min_price IS NOT NULL AND v_unit_price < v_product.min_price THEN
                RAISE EXCEPTION 'Harga untuk "%" di bawah batas minimum (%)',
                    v_product.name, v_product.min_price;
            END IF;
            v_item_name := left(v_product.name || ': ' || v_item_desc, 200);
        END IF;

        INSERT INTO transaction_items ($check$;
begin
  for v_oid in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'e_pos' and p.proname = 'create_transaction'
  loop
    v_def := pg_get_functiondef(v_oid);

    if position('v_item_name' in v_def) > 0 then
      continue;
    end if;

    v_new := regexp_replace(v_def, '(v_item_subtotal\s+BIGINT;)', E'\\1\n    v_item_name TEXT;\n    v_item_desc TEXT;');
    if v_new = v_def then
      raise exception 'Migration 055: deklarasi v_item_subtotal tidak ditemukan di create_transaction.';
    end if;

    v_def := v_new;
    v_new := regexp_replace(v_def, 'INSERT\s+INTO\s+transaction_items\s*\(', replace(v_check, '\', '\\'));
    if v_new = v_def then
      raise exception 'Migration 055: INSERT INTO transaction_items tidak ditemukan di create_transaction.';
    end if;

    v_def := v_new;
    v_new := regexp_replace(v_def, '(v_product\.id,\s*)v_product\.name,', E'\\1v_item_name,');
    if v_new = v_def then
      raise exception 'Migration 055: kolom nama pada INSERT transaction_items tidak ditemukan.';
    end if;

    execute v_new;
    v_patched := v_patched + 1;
  end loop;

  if v_patched = 0 and not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'e_pos' and p.proname = 'create_transaction'
       and position('v_item_name' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'Migration 055: create_transaction tidak ditemukan di schema e_pos.';
  end if;
end $$;

commit;
