-- =====================================================================
-- E-POS -- STRUKTUR DATABASE, schema kustom `e_pos`
-- SUMBER: pg_dump --schema-only dari database produksi lama (schema public,
-- PostgreSQL 17.6), bukan dari supabase/schema.sql di repo (sudah usang).
-- Semua `public.` diganti `e_pos.`.
--
-- URUTAN PAKAI:
--   1. Tambahkan `e_pos` ke PGRST_DB_SCHEMAS lalu restart service `rest`.
--   2. Jalankan file ini SEKALI di database yang belum punya schema e_pos:
--        psql "<koneksi>" -v ON_ERROR_STOP=1 --single-transaction -f schema_e_pos.sql
--   3. Buat admin pertama (lihat BAGIAN D di paling bawah).
-- =====================================================================

-- Pengaman: hentikan kalau schema e_pos sudah berisi tabel aplikasi.
DO $guard$
BEGIN
  IF to_regclass('e_pos.transactions') IS NOT NULL THEN
    RAISE EXCEPTION 'e_pos.transactions sudah ada -- dibatalkan.';
  END IF;
END
$guard$;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: e_pos; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS e_pos;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA e_pos IS 'Aplikasi E-POS (Langitan)';


--
-- Name: payment_method; Type: TYPE; Schema: e_pos; Owner: -
--

CREATE TYPE e_pos.payment_method AS ENUM (
    'CASH',
    'DIGITAL',
    'TEMPO'
);


--
-- Name: TYPE payment_method; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TYPE e_pos.payment_method IS 'Metode bayar: CASH = tunai, DIGITAL = pembayaran digital (Midtrans), TEMPO = piutang.';


--
-- Name: product_type; Type: TYPE; Schema: e_pos; Owner: -
--

CREATE TYPE e_pos.product_type AS ENUM (
    'FASHION',
    'SABLON',
    'KONVEKSI',
    'PERCETAKAN',
    'MERCHANDISE',
    'PARFUM',
    'JASA',
    'KEMASAN'
);


--
-- Name: transaction_status; Type: TYPE; Schema: e_pos; Owner: -
--

CREATE TYPE e_pos.transaction_status AS ENUM (
    'selesai',
    'retur',
    'void',
    'pending',
    'PAID',
    'RETURN',
    'VOID'
);


--
-- Name: add_cash_movement(text, bigint, text, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.add_cash_movement(p_type text, p_amount bigint, p_category text, p_note text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_note     text := btrim(coalesce(p_note, ''));
  v_shift_id uuid;
  v_id       uuid;
  v_totals   jsonb;
begin
  if v_uid is null then
    raise exception 'Harus login untuk mencatat kas.';
  end if;

  if not e_pos.has_permission_action('kasir', 'view') then
    raise exception 'Anda tidak punya izin mencatat kas masuk/keluar.';
  end if;

  if p_type is null or p_type not in ('IN', 'OUT') then
    raise exception 'Jenis kas harus kas masuk atau kas keluar.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal harus lebih dari 0.';
  end if;

  if p_amount > 1000000000 then
    raise exception 'Nominal terlalu besar.';
  end if;

  if char_length(v_note) < 3 then
    raise exception 'Keterangan wajib diisi (minimal 3 karakter).';
  end if;

  if not (
    (p_type = 'IN'  and p_category in ('tambah_modal', 'titipan', 'lainnya_masuk'))
    or
    (p_type = 'OUT' and p_category in ('operasional', 'ongkir', 'setor_owner', 'belanja_stok', 'lainnya_keluar'))
  ) then
    raise exception 'Kategori tidak sesuai dengan jenis kas.';
  end if;

  -- Kunci baris shift: serial dengan close_shift (yang juga mengunci baris
  -- ini), jadi tidak mungkin mencatat kas SETELAH shift ditutup.
  select id into v_shift_id
  from shift_sessions
  where cashier_id = v_uid
    and status = 'OPEN'
  for update;

  if v_shift_id is null then
    raise exception 'Anda belum membuka shift kasir. Buka shift terlebih dahulu.';
  end if;

  if p_type = 'OUT' then
    v_totals := e_pos.shift_cash_totals(v_shift_id);
    -- Pesan sengaja TANPA angka: kasir tidak boleh bisa membaca saldo laci
    -- seharusnya lewat pesan error (penutupan kas dibuat "buta").
    if p_amount > (v_totals->>'expected_cash')::bigint then
      raise exception 'Kas keluar melebihi uang tunai yang seharusnya ada di laci shift ini.';
    end if;
  end if;

  insert into cash_movements (shift_id, type, amount, category, note, created_by)
  values (v_shift_id, p_type, p_amount, p_category, v_note, v_uid)
  returning id into v_id;

  insert into activity_logs (user_id, action, entity, entity_id, meta)
  values (
    v_uid,
    case when p_type = 'IN' then 'cash_in' else 'cash_out' end,
    'shift',
    v_shift_id,
    jsonb_build_object(
      'movement_id', v_id,
      'amount', p_amount,
      'category', p_category,
      'note', v_note
    )
  );

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'shift_id', v_shift_id,
    'type', p_type,
    'amount', p_amount
  );
end;
$$;


--
-- Name: FUNCTION add_cash_movement(p_type text, p_amount bigint, p_category text, p_note text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.add_cash_movement(p_type text, p_amount bigint, p_category text, p_note text) IS 'Catat kas masuk (IN) / keluar (OUT) pada shift aktif pemanggil. Migration 040. Kas keluar ditolak kalau melebihi kas seharusnya (pesan tanpa angka). Izin: menu kasir (lihat).';


--
-- Name: adjust_customer_points(uuid, integer, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.adjust_customer_points(p_customer_id uuid, p_delta integer, p_reason text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_current integer;
  v_after integer;
begin
  if not e_pos.has_permission_action('pelanggan', 'edit') then
    raise exception 'Anda tidak punya izin mengubah poin pelanggan.';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Jumlah poin tidak boleh 0.';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan penyesuaian poin wajib diisi.';
  end if;

  select loyalty_points into v_current
  from e_pos.customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'Pelanggan tidak ditemukan.';
  end if;

  v_after := v_current + p_delta;

  if v_after < 0 then
    raise exception 'Poin tidak boleh negatif. Saldo saat ini %, perubahan %', v_current, p_delta;
  end if;

  update e_pos.customers
  set loyalty_points = v_after,
      updated_at = now()
  where id = p_customer_id;

  insert into e_pos.customer_point_logs
    (customer_id, type, points_delta, balance_after, reason, created_by)
  values
    (p_customer_id, 'adjust', p_delta, v_after, btrim(p_reason), auth.uid());

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'adjust_points', 'customer', p_customer_id,
    jsonb_build_object('delta', p_delta, 'balance_after', v_after, 'reason', btrim(p_reason))
  );

  return v_after;
end;
$$;


--
-- Name: adjust_stock(uuid, text, integer, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
    v_product RECORD;
    v_old_stock INTEGER;
    v_qty_delta INTEGER;
    v_new_stock INTEGER;
    v_movement_id UUID;
begin
    IF NOT e_pos.has_permission_action('stok', 'edit') THEN
        RAISE EXCEPTION 'Anda tidak punya izin untuk mengubah stok';
    END IF;

    IF p_type IS NULL OR p_type NOT IN ('opname', 'adjustment') THEN
        RAISE EXCEPTION 'Jenis mutasi manual tidak valid (hanya opname / adjustment)';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'Alasan wajib diisi untuk mutasi stok manual';
    END IF;

    IF p_value IS NULL THEN
        RAISE EXCEPTION 'Jumlah tidak boleh kosong';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;

    IF v_product.is_service = TRUE OR v_product.type = 'JASA' THEN
        RAISE EXCEPTION 'Produk "%" adalah jasa — stoknya tidak terbatas dan tidak bisa diopname', v_product.name;
    END IF;

    v_old_stock := COALESCE(v_product.stock, 0);

    IF p_type = 'opname' THEN
        IF p_value < 0 THEN
            RAISE EXCEPTION 'Hasil hitung fisik tidak boleh negatif';
        END IF;
        v_qty_delta := p_value - v_old_stock;
    ELSE
        IF p_value = 0 THEN
            RAISE EXCEPTION 'Penyesuaian 0 tidak ada artinya — isi jumlah plus atau minus';
        END IF;
        v_qty_delta := p_value;
    END IF;

    v_new_stock := v_old_stock + v_qty_delta;
    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'Stok tidak boleh minus. Stok sekarang %, penyesuaian %', v_old_stock, v_qty_delta;
    END IF;

    IF v_qty_delta <> 0 THEN
        UPDATE products SET stock = v_new_stock, updated_at = NOW() WHERE id = p_product_id;
    END IF;

    INSERT INTO stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    VALUES (p_product_id, p_type, v_qty_delta, NULL, btrim(p_reason), auth.uid())
    RETURNING id INTO v_movement_id;

    INSERT INTO activity_logs (user_id, action, entity, entity_id, meta)
    VALUES (
        auth.uid(),
        CASE WHEN p_type = 'opname' THEN 'stock_opname' ELSE 'stock_adjustment' END,
        'product', p_product_id,
        jsonb_build_object(
            'product_name', v_product.name, 'reason', btrim(p_reason),
            'old_stock', v_old_stock, 'qty_delta', v_qty_delta,
            'new_stock', v_new_stock, 'movement_id', v_movement_id
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE, 'movement_id', v_movement_id, 'product_id', p_product_id,
        'product_name', v_product.name, 'old_stock', v_old_stock,
        'qty_delta', v_qty_delta, 'new_stock', v_new_stock
    );
EXCEPTION
    WHEN OTHERS THEN RAISE;
END;
$$;


--
-- Name: FUNCTION adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.adjust_stock(p_product_id uuid, p_type text, p_value integer, p_reason text) IS 'Opname/penyesuaian stok manual. Migration 031: gate diganti ke has_permission_action(''stok'',''edit'') (pecahan granular dari has_permission(''stok'') migration 028). Logika stok/validasi tidak berubah.';


--
-- Name: admin_set_user_active(uuid, boolean); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.admin_set_user_active(p_user_id uuid, p_is_active boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_target record;
begin
  if not e_pos.has_permission_action('pengaturan_admin', 'edit') then
    raise exception 'Anda tidak punya izin untuk mengubah status user';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Tidak bisa menonaktifkan diri sendiri — minta user lain yang berwenang melakukannya';
  end if;

  select p.id, p.full_name, p.is_active, p.roles
    into v_target
  from e_pos.profiles p
  where p.id = p_user_id
  for update of p;

  if not found then
    raise exception 'User tidak ditemukan';
  end if;

  if 'super_admin' = any(v_target.roles) and not e_pos.is_super_admin() then
    raise exception 'Hanya Super Admin yang boleh mengubah status akun Super Admin';
  end if;

  if v_target.is_active = p_is_active then
    raise exception 'User sudah dalam status tersebut';
  end if;

  -- Penjagaan "Super Admin terakhir" ditegakkan trigger enforce_profiles_role_change.
  update e_pos.profiles set is_active = p_is_active where id = p_user_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    case when p_is_active then 'user_activate' else 'user_deactivate' end,
    'user', p_user_id,
    jsonb_build_object('target_name', v_target.full_name)
  );

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'is_active', p_is_active);
end;
$$;


--
-- Name: FUNCTION admin_set_user_active(p_user_id uuid, p_is_active boolean); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.admin_set_user_active(p_user_id uuid, p_is_active boolean) IS 'Aktifkan/nonaktifkan user. Migration 038: gate pengaturan_admin.edit; hanya Super Admin yang boleh mengubah akun Super Admin; tidak bisa diri sendiri. Hierarki level dihapus.';


--
-- Name: cancel_stock_opname(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.cancel_stock_opname(p_session_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_session e_pos.stock_opname_sessions%rowtype;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan pembatalan wajib diisi';
  end if;

  select * into v_session from e_pos.stock_opname_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'Sesi opname #% sudah %',
      v_session.number,
      case v_session.status when 'completed' then 'selesai' else 'dibatalkan' end;
  end if;

  update e_pos.stock_opname_sessions
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = btrim(p_reason)
   where id = p_session_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'opname_cancel', 'stock_opname', p_session_id,
    jsonb_build_object(
      'opname_number', v_session.number,
      'session_name', v_session.name,
      'reason', format('Opname #%s (%s) dibatalkan: %s', v_session.number, v_session.name, btrim(p_reason))
    )
  );

  return jsonb_build_object('success', true, 'session_id', p_session_id, 'number', v_session.number);
end;
$$;


--
-- Name: FUNCTION cancel_stock_opname(p_session_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.cancel_stock_opname(p_session_id uuid, p_reason text) IS 'Batalkan sesi opname draft. Stok tidak berubah sama sekali. Alasan wajib. Butuh izin stok:edit.';


--
-- Name: close_shift(uuid, bigint, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.close_shift(p_shift_id uuid, p_actual_cash bigint, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
    v_shift RECORD;
    v_caller_id UUID;
    v_can_force_close BOOLEAN := FALSE;
    v_totals JSONB;
    v_expected_cash BIGINT;
    v_difference BIGINT;
    v_notes TEXT;
    v_held BIGINT := 0;
    v_pending BIGINT := 0;
    v_parts TEXT[] := ARRAY[]::TEXT[];
    v_list TEXT;
begin
    v_caller_id := auth.uid();

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Anda belum login';
    END IF;

    IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
        RAISE EXCEPTION 'Nominal kas fisik tidak valid';
    END IF;

    v_notes := nullif(btrim(coalesce(p_notes, '')), '');

    SELECT * INTO v_shift FROM shift_sessions WHERE id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift tidak ditemukan';
    END IF;

    IF v_shift.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
    END IF;

    -- Migration 028: role apa pun dengan flag lintas_kasir boleh force-close shift orang lain.
    v_can_force_close := e_pos.current_role_lintas_kasir();

    IF v_shift.cashier_id <> v_caller_id AND NOT v_can_force_close THEN
        RAISE EXCEPTION 'Anda tidak berhak menutup shift ini';
    END IF;

    -- ── PERUBAHAN (041) ── Gerbang pekerjaan belum selesai.
    -- held_orders & digital_payments tidak punya shift_id, jadi batasnya
    -- kasir pemilik sesi (dan, untuk pembayaran digital, waktu sejak sesi dibuka).
    SELECT count(*) INTO v_held
    FROM held_orders
    WHERE cashier_id = v_shift.cashier_id;

    SELECT count(*) INTO v_pending
    FROM digital_payments
    WHERE cashier_id = v_shift.cashier_id
      AND status = 'pending'
      AND created_at >= v_shift.opened_at;

    IF v_held > 0 THEN
        v_parts := v_parts || format('%s pesanan tahan', v_held);
    END IF;
    IF v_pending > 0 THEN
        v_parts := v_parts || format('%s pembayaran digital menunggu konfirmasi', v_pending);
    END IF;

    IF array_length(v_parts, 1) IS NOT NULL THEN
        IF array_length(v_parts, 1) = 1 THEN
            v_list := v_parts[1];
        ELSE
            v_list := v_parts[1] || ' dan ' || v_parts[2];
        END IF;
        RAISE EXCEPTION 'Masih ada % di sesi ini. Selesaikan atau batalkan dulu sebelum menutup sesi.', v_list;
    END IF;

    -- Rumus kas seharusnya dari satu tempat (040).
    v_totals := e_pos.shift_cash_totals(p_shift_id);
    v_expected_cash := (v_totals->>'expected_cash')::BIGINT;
    v_difference := p_actual_cash - v_expected_cash;

    -- ── PERUBAHAN (041) ── Selisih wajib dijelaskan.
    IF v_difference <> 0 AND v_notes IS NULL THEN
        RAISE EXCEPTION 'Isi alasan selisih kas sebelum menutup sesi';
    END IF;

    UPDATE shift_sessions
    SET status = 'CLOSED',
        closed_at = NOW(),
        closed_by = v_caller_id,
        actual_cash = p_actual_cash,
        expected_cash = v_expected_cash,
        difference = v_difference,
        notes = CASE
                  WHEN v_notes IS NULL THEN notes
                  WHEN notes IS NULL OR btrim(notes) = '' THEN v_notes
                  ELSE notes || ' | ' || v_notes
                END
    WHERE id = p_shift_id;

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'opening_cash', (v_totals->>'opening_cash')::BIGINT,
        'cash_sales', (v_totals->>'cash_sales')::BIGINT,
        'cash_refunds', (v_totals->>'cash_refunds')::BIGINT,
        'cash_voided', (v_totals->>'cash_voided')::BIGINT,
        'cash_in', (v_totals->>'cash_in')::BIGINT,
        'cash_out', (v_totals->>'cash_out')::BIGINT,
        'expected_cash', v_expected_cash,
        'actual_cash', p_actual_cash,
        'difference', v_difference,
        'closed_by', v_caller_id,
        'notes', v_notes
    );
end;
$$;


--
-- Name: create_transaction(jsonb, bigint, bigint, bigint, bigint, text, text, e_pos.payment_method, bigint, bigint, date, text, jsonb, uuid, integer); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint DEFAULT 0, p_tax bigint DEFAULT 0, p_total bigint DEFAULT 0, p_customer_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method e_pos.payment_method DEFAULT 'CASH'::e_pos.payment_method, p_payment_amount bigint DEFAULT 0, p_received_amount bigint DEFAULT NULL::bigint, p_due_date date DEFAULT NULL::date, p_customer_phone text DEFAULT NULL::text, p_payments jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_points_redeemed integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
    v_transaction_id UUID;
    v_receipt_no TEXT;
    v_item JSONB;
    v_product_id UUID;
    v_product RECORD;
    v_qty INTEGER;
    v_unit_price BIGINT;
    v_item_discount BIGINT;
    v_item_subtotal BIGINT;
    v_payment_id UUID;
    v_change BIGINT := 0;
    v_sequence BIGINT;
    v_cashier_id UUID;
    v_shift_id UUID;
    -- ── (021) ── variabel khusus split payment
    v_is_split BOOLEAN;
    v_split_line JSONB;
    v_line_method payment_method;
    v_line_amount BIGINT;
    v_line_received BIGINT;
    v_line_due_date DATE;
    v_line_change BIGINT;
    v_line_payment_id UUID;
    v_payments_sum BIGINT := 0;
    v_payments_result JSONB := '[]'::jsonb;
    v_seen_methods payment_method[] := array[]::payment_method[];
    -- ── TAMBAHAN (036) ── pelanggan & poin
    v_customer RECORD;
    v_points_redeemed INTEGER := COALESCE(p_points_redeemed, 0);
    v_earnable BIGINT := 0;
    v_points_earned INTEGER := 0;
    v_balance INTEGER;
begin

    -- --------------------------------------------------------
    -- Basic validation
    -- --------------------------------------------------------

    IF p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0
    THEN
        RAISE EXCEPTION 'Transaction must contain at least one item';
    END IF;

    IF p_subtotal < 0
       OR p_discount < 0
       OR p_tax < 0
       OR p_total < 0
    THEN
        RAISE EXCEPTION 'Transaction amounts cannot be negative';
    END IF;

    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;

    v_is_split :=
        p_payments IS NOT NULL
        AND jsonb_typeof(p_payments) = 'array'
        AND jsonb_array_length(p_payments) > 0;

    IF v_is_split THEN

        IF jsonb_array_length(p_payments) > 4 THEN
            RAISE EXCEPTION 'Maksimal 4 metode pembayaran per transaksi';
        END IF;

        FOR v_split_line IN
            SELECT value
            FROM jsonb_array_elements(p_payments)
        LOOP

            v_line_method := (v_split_line->>'method')::payment_method;
            v_line_amount := (v_split_line->>'amount')::BIGINT;

            IF v_line_method = ANY(v_seen_methods) THEN
                RAISE EXCEPTION
                    'Metode pembayaran % dipakai lebih dari sekali',
                    v_line_method;
            END IF;
            v_seen_methods := array_append(v_seen_methods, v_line_method);

            IF v_line_amount IS NULL OR v_line_amount <= 0 THEN
                RAISE EXCEPTION
                    'Nominal pembayaran metode % tidak valid',
                    v_line_method;
            END IF;
            v_payments_sum := v_payments_sum + v_line_amount;

            IF v_line_method = 'CASH' THEN
                v_line_received := (v_split_line->>'received_amount')::BIGINT;
                IF v_line_received IS NULL OR v_line_received < v_line_amount THEN
                    RAISE EXCEPTION
                        'Uang tunai yang diterima kurang dari porsi tunai';
                END IF;
            END IF;

            IF v_line_method = 'TEMPO' THEN
                IF (v_split_line->>'due_date') IS NULL THEN
                    RAISE EXCEPTION
                        'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
                END IF;
                IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
                    RAISE EXCEPTION
                        'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
                END IF;
            END IF;

        END LOOP;

        IF v_payments_sum <> p_total THEN
            RAISE EXCEPTION
                'Jumlah pembayaran (%) tidak sama dengan total transaksi (%)',
                v_payments_sum, p_total;
        END IF;

    ELSE

        IF p_payment_method = 'TEMPO' THEN
            IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
                RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
            END IF;

            IF p_due_date IS NULL THEN
                RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
            END IF;
        END IF;

    END IF;

    -- --------------------------------------------------------
    -- ── TAMBAHAN (036) ── Validasi pelanggan & poin. Baris pelanggan
    -- dikunci (FOR UPDATE) supaya dua transaksi bersamaan tidak bisa
    -- memakai poin yang sama dua kali.
    -- --------------------------------------------------------

    IF v_points_redeemed < 0 THEN
        RAISE EXCEPTION 'Jumlah poin yang dipakai tidak valid';
    END IF;

    IF p_customer_id IS NOT NULL THEN
        SELECT id, loyalty_points, is_active
        INTO v_customer
        FROM customers
        WHERE id = p_customer_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pelanggan tidak ditemukan.';
        END IF;

        IF NOT v_customer.is_active THEN
            RAISE EXCEPTION 'Pelanggan ini sudah dinonaktifkan.';
        END IF;
    END IF;

    IF v_points_redeemed > 0 THEN
        IF p_customer_id IS NULL THEN
            RAISE EXCEPTION 'Pilih pelanggan terlebih dahulu untuk memakai poin.';
        END IF;

        IF v_customer.loyalty_points < v_points_redeemed THEN
            RAISE EXCEPTION
                'Poin tidak cukup. Tersedia %, diminta %',
                v_customer.loyalty_points, v_points_redeemed;
        END IF;

        IF p_discount < v_points_redeemed::BIGINT * e_pos.loyalty_point_value() THEN
            RAISE EXCEPTION
                'Potongan transaksi lebih kecil dari nilai poin yang dipakai';
        END IF;
    END IF;

    v_cashier_id := auth.uid();

    IF v_cashier_id IS NOT NULL THEN
        SELECT id
        INTO v_shift_id
        FROM shift_sessions
        WHERE cashier_id = v_cashier_id
          AND status = 'OPEN'
        LIMIT 1;

        IF v_shift_id IS NULL THEN
            RAISE EXCEPTION
                'Anda belum membuka shift kasir. Buka shift terlebih dahulu sebelum bertransaksi.';
        END IF;
    END IF;


    -- --------------------------------------------------------
    -- Generate receipt sequence
    -- --------------------------------------------------------

    SELECT COALESCE(
        MAX(
            split_part(receipt_no, '/', 4)::BIGINT
        ),
        0
    ) + 1
    INTO v_sequence
    FROM transactions
    WHERE receipt_no LIKE
        'LCO-STR/'
        || TO_CHAR(NOW(), 'YY')
        || '/'
        || TO_CHAR(NOW(), 'MM')
        || '/%';

    v_receipt_no :=
        'LCO-STR/'
        || TO_CHAR(NOW(), 'YY')
        || '/'
        || TO_CHAR(NOW(), 'MM')
        || '/'
        || LPAD(v_sequence::TEXT, 6, '0');


    -- --------------------------------------------------------
    -- Create transaction header
    -- --------------------------------------------------------

    INSERT INTO transactions (
        receipt_no,
        status,
        subtotal,
        discount,
        tax,
        total,
        customer_name,
        customer_phone,
        notes,
        cashier_id,
        shift_id,
        customer_id,
        points_redeemed
    )
    VALUES (
        v_receipt_no,
        'PAID',
        p_subtotal,
        p_discount,
        p_tax,
        p_total,
        p_customer_name,
        p_customer_phone,
        p_notes,
        v_cashier_id,
        v_shift_id,
        p_customer_id,
        v_points_redeemed
    )
    RETURNING id INTO v_transaction_id;


    -- --------------------------------------------------------
    -- Process transaction items
    -- --------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP

        v_product_id :=
            (v_item->>'product_id')::UUID;

        v_qty :=
            (v_item->>'qty')::INTEGER;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION
                'Invalid quantity for product %',
                v_product_id;
        END IF;


        SELECT *
        INTO v_product
        FROM products
        WHERE id = v_product_id
          AND is_active = TRUE
          AND deleted_at IS NULL
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Product % is not available',
                v_product_id;
        END IF;


        IF NOT (
            v_product.is_service = TRUE
            OR v_product.type = 'JASA'
        ) THEN

            IF COALESCE(v_product.stock, 0) < v_qty THEN
                RAISE EXCEPTION
                    'Insufficient stock for product "%". Available: %, requested: %',
                    v_product.name,
                    COALESCE(v_product.stock, 0),
                    v_qty;
            END IF;

            UPDATE products
            SET
                stock = stock - v_qty,
                updated_at = NOW()
            WHERE id = v_product_id;

            INSERT INTO stock_movements (
                product_id, type, qty_delta, reference_id, reason, created_by
            )
            VALUES (
                v_product_id, 'sale', -v_qty, v_transaction_id, NULL, v_cashier_id
            );

        END IF;


        v_unit_price :=
            COALESCE(
                (v_item->>'unit_price')::BIGINT,
                v_product.sell_price
            );

        v_item_discount :=
            COALESCE(
                (v_item->>'discount')::BIGINT,
                0
            );

        v_item_subtotal :=
            COALESCE(
                (v_item->>'subtotal')::BIGINT,
                (v_unit_price * v_qty) - v_item_discount
            );


        INSERT INTO transaction_items (
            transaction_id,
            product_id,
            product_name,
            sku,
            unit,
            qty,
            unit_price,
            discount,
            subtotal
        )
        VALUES (
            v_transaction_id,
            v_product.id,
            v_product.name,
            v_product.sku,
            v_product.unit,
            v_qty,
            v_unit_price,
            v_item_discount,
            v_item_subtotal
        );

    END LOOP;


    -- --------------------------------------------------------
    -- Save payment(s)
    -- --------------------------------------------------------

    IF v_is_split THEN

        FOR v_split_line IN
            SELECT value
            FROM jsonb_array_elements(p_payments)
        LOOP

            v_line_method := (v_split_line->>'method')::payment_method;
            v_line_amount := (v_split_line->>'amount')::BIGINT;

            v_line_received :=
                CASE WHEN v_line_method = 'CASH'
                     THEN (v_split_line->>'received_amount')::BIGINT
                     ELSE NULL
                END;

            v_line_due_date :=
                CASE WHEN v_line_method = 'TEMPO'
                     THEN (v_split_line->>'due_date')::DATE
                     ELSE NULL
                END;

            v_line_change := 0;
            IF v_line_method = 'CASH' THEN
                v_line_change := v_line_received - v_line_amount;
                v_change := v_change + v_line_change;
            END IF;

            INSERT INTO payments (
                transaction_id,
                method,
                amount,
                received_amount,
                change_amount,
                due_date
            )
            VALUES (
                v_transaction_id,
                v_line_method,
                v_line_amount,
                v_line_received,
                v_line_change,
                v_line_due_date
            )
            RETURNING id INTO v_line_payment_id;

            IF v_payment_id IS NULL THEN
                v_payment_id := v_line_payment_id;
            END IF;

            v_payments_result := v_payments_result || jsonb_build_array(
                jsonb_build_object(
                    'payment_id', v_line_payment_id,
                    'method', v_line_method,
                    'amount', v_line_amount
                )
            );

        END LOOP;

    ELSE

        IF p_payment_method = 'CASH' THEN

            IF p_received_amount IS NULL THEN
                RAISE EXCEPTION
                    'Received amount is required for cash payment';
            END IF;

            IF p_received_amount < p_total THEN
                RAISE EXCEPTION
                    'Cash received is insufficient';
            END IF;

            v_change :=
                p_received_amount - p_total;

        END IF;

        INSERT INTO payments (
            transaction_id,
            method,
            amount,
            received_amount,
            change_amount,
            due_date
        )
        VALUES (
            v_transaction_id,
            p_payment_method,
            p_payment_amount,
            p_received_amount,
            v_change,
            CASE WHEN p_payment_method = 'TEMPO' THEN p_due_date ELSE NULL END
        )
        RETURNING id INTO v_payment_id;

        v_payments_result := jsonb_build_array(
            jsonb_build_object(
                'payment_id', v_payment_id,
                'method', p_payment_method,
                'amount', p_payment_amount
            )
        );

    END IF;


    -- --------------------------------------------------------
    -- ── TAMBAHAN (036) ── Poin: pakai (kalau ada) lalu tambah dari belanja.
    -- Semua di transaksi database yang sama dengan penjualan.
    -- --------------------------------------------------------

    IF p_customer_id IS NOT NULL THEN

        v_balance := v_customer.loyalty_points;

        IF v_points_redeemed > 0 THEN
            v_balance := v_balance - v_points_redeemed;

            INSERT INTO customer_point_logs (
                customer_id, type, points_delta, balance_after,
                reason, created_by, transaction_id
            )
            VALUES (
                p_customer_id, 'redeem', -v_points_redeemed, v_balance,
                'Dipakai sebagai potongan di ' || v_receipt_no,
                v_cashier_id, v_transaction_id
            );
        END IF;

        -- Dasar perolehan poin: hanya bagian yang dibayar TUNAI/DIGITAL.
        IF v_is_split THEN
            SELECT COALESCE(SUM((line->>'amount')::BIGINT), 0)
            INTO v_earnable
            FROM jsonb_array_elements(p_payments) AS line
            WHERE (line->>'method') <> 'TEMPO';
        ELSIF p_payment_method <> 'TEMPO' THEN
            v_earnable := p_payment_amount;
        END IF;

        v_points_earned := (v_earnable / e_pos.loyalty_earn_unit())::INTEGER;

        IF v_points_earned > 0 THEN
            v_balance := v_balance + v_points_earned;

            INSERT INTO customer_point_logs (
                customer_id, type, points_delta, balance_after,
                reason, created_by, transaction_id
            )
            VALUES (
                p_customer_id, 'earn', v_points_earned, v_balance,
                'Belanja ' || v_receipt_no,
                v_cashier_id, v_transaction_id
            );

            UPDATE transactions
            SET points_earned = v_points_earned
            WHERE id = v_transaction_id;
        END IF;

        IF v_points_redeemed > 0 OR v_points_earned > 0 THEN
            UPDATE customers
            SET loyalty_points = v_balance,
                updated_at = NOW()
            WHERE id = p_customer_id;
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Return result
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'success', TRUE,
        'transaction_id', v_transaction_id,
        'receipt_no', v_receipt_no,
        'payment_id', v_payment_id,
        'payments', v_payments_result,
        'change_amount', v_change,
        'shift_id', v_shift_id,
        'points_redeemed', v_points_redeemed,
        'points_earned', v_points_earned,
        'points_balance', v_balance
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION
            'Failed to generate unique receipt number. Please retry the transaction';

    WHEN OTHERS THEN
        RAISE;
END;
$$;


--
-- Name: FUNCTION create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint, p_tax bigint, p_total bigint, p_customer_name text, p_notes text, p_payment_method e_pos.payment_method, p_payment_amount bigint, p_received_amount bigint, p_due_date date, p_customer_phone text, p_payments jsonb, p_customer_id uuid, p_points_redeemed integer); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.create_transaction(p_items jsonb, p_subtotal bigint, p_discount bigint, p_tax bigint, p_total bigint, p_customer_name text, p_notes text, p_payment_method e_pos.payment_method, p_payment_amount bigint, p_received_amount bigint, p_due_date date, p_customer_phone text, p_payments jsonb, p_customer_id uuid, p_points_redeemed integer) IS 'Buat transaksi penjualan. Migration 036: menerima p_customer_id & p_points_redeemed; potong poin, tambah poin dari belanja tunai/digital, dan catat riwayat poin dalam transaksi database yang sama.';


--
-- Name: create_transaction_digital(text, jsonb, bigint, bigint, bigint, bigint, text, text, e_pos.payment_method, bigint, bigint, date, text, jsonb, uuid, integer); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.create_transaction_digital(p_order_id text, p_items jsonb, p_subtotal bigint, p_discount bigint DEFAULT 0, p_tax bigint DEFAULT 0, p_total bigint DEFAULT 0, p_customer_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method e_pos.payment_method DEFAULT 'DIGITAL'::e_pos.payment_method, p_payment_amount bigint DEFAULT 0, p_received_amount bigint DEFAULT NULL::bigint, p_due_date date DEFAULT NULL::date, p_customer_phone text DEFAULT NULL::text, p_payments jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_points_redeemed integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_dp          e_pos.digital_payments%rowtype;
  v_digital_amt bigint;
  v_line        jsonb;
  v_result      jsonb;
  v_txn_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'Harus login untuk menyimpan transaksi.';
  end if;

  if p_order_id is null or trim(p_order_id) = '' then
    raise exception 'Order ID pembayaran digital wajib diisi.';
  end if;

  -- Kunci baris supaya dua request tidak bisa memakai order yang sama.
  select * into v_dp
  from e_pos.digital_payments
  where order_id = p_order_id
  for update;

  if not found then
    raise exception 'Order pembayaran digital % tidak ditemukan.', p_order_id;
  end if;

  if v_dp.cashier_id <> auth.uid() then
    raise exception 'Order pembayaran digital ini dibuat oleh kasir lain.';
  end if;

  if v_dp.status <> 'paid' then
    raise exception
      'Pembayaran digital belum lunas (status: %). Transaksi tidak disimpan.',
      v_dp.status;
  end if;

  if v_dp.transaction_id is not null then
    raise exception 'Order pembayaran digital ini sudah dipakai untuk transaksi lain.';
  end if;

  -- Nominal DIGITAL di transaksi harus sama persis dengan yang dibayar.
  if p_payments is not null then
    select (l->>'amount')::bigint into v_digital_amt
    from jsonb_array_elements(p_payments) as l
    where l->>'method' = 'DIGITAL'
    limit 1;
  elsif p_payment_method = 'DIGITAL' then
    v_digital_amt := p_total;
  end if;

  if v_digital_amt is null then
    raise exception 'Transaksi ini tidak memiliki pembayaran DIGITAL.';
  end if;

  if v_digital_amt <> v_dp.gross_amount then
    raise exception
      'Nominal digital transaksi (%) tidak sama dengan yang dibayar (%).',
      v_digital_amt, v_dp.gross_amount;
  end if;

  -- Simpan transaksi memakai fungsi yang sudah ada (stok, kas, shift, poin, dst.).
  v_result := e_pos.create_transaction(
    p_items          => p_items,
    p_subtotal       => p_subtotal,
    p_discount       => p_discount,
    p_tax            => p_tax,
    p_total          => p_total,
    p_customer_name  => p_customer_name,
    p_notes          => p_notes,
    p_payment_method => p_payment_method,
    p_payment_amount => p_payment_amount,
    p_received_amount => p_received_amount,
    p_due_date       => p_due_date,
    p_customer_phone => p_customer_phone,
    p_payments       => p_payments,
    -- ── TAMBAHAN (038) ──
    p_customer_id     => p_customer_id,
    p_points_redeemed => p_points_redeemed
  );

  v_txn_id := (v_result->>'transaction_id')::uuid;

  -- Simpan Order ID sebagai nomor referensi di baris pembayaran DIGITAL.
  update e_pos.payments
     set reference_no = p_order_id
   where transaction_id = v_txn_id
     and method = 'DIGITAL';

  update e_pos.digital_payments
     set transaction_id = v_txn_id,
         used_at = now(),
         updated_at = now()
   where id = v_dp.id;

  return v_result;
end;
$$;


--
-- Name: FUNCTION create_transaction_digital(p_order_id text, p_items jsonb, p_subtotal bigint, p_discount bigint, p_tax bigint, p_total bigint, p_customer_name text, p_notes text, p_payment_method e_pos.payment_method, p_payment_amount bigint, p_received_amount bigint, p_due_date date, p_customer_phone text, p_payments jsonb, p_customer_id uuid, p_points_redeemed integer); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.create_transaction_digital(p_order_id text, p_items jsonb, p_subtotal bigint, p_discount bigint, p_tax bigint, p_total bigint, p_customer_name text, p_notes text, p_payment_method e_pos.payment_method, p_payment_amount bigint, p_received_amount bigint, p_due_date date, p_customer_phone text, p_payments jsonb, p_customer_id uuid, p_points_redeemed integer) IS 'Verifikasi order Midtrans lunas lalu simpan transaksi lewat create_transaction. Migration 038: meneruskan p_customer_id & p_points_redeemed.';


--
-- Name: current_role_id(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.current_role_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select p.id from e_pos.profiles p
  where p.id = auth.uid() and p.is_active = true;
$$;


--
-- Name: FUNCTION current_role_id(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.current_role_id() IS 'NON-NULL (= id user) kalau user login aktif, NULL kalau tidak. Migration 038: role dinamis dihapus, nama dipertahankan karena dipakai policy lama sebagai cek "user aktif".';


--
-- Name: current_role_level(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.current_role_level() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select case
    when 'super_admin' = any(p.roles) then 0
    when 'admin'       = any(p.roles) then 1
    when 'supervisor'  = any(p.roles) then 2
    else 10
  end
  from e_pos.profiles p
  where p.id = auth.uid() and p.is_active = true;
$$;


--
-- Name: FUNCTION current_role_level(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.current_role_level() IS 'DEPRECATED (migration 038): hierarki level dihapus. Hanya shim kompatibilitas — jangan dipakai di kode baru, pakai is_super_admin()/has_permission_action().';


--
-- Name: current_role_lintas_kasir(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.current_role_lintas_kasir() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select coalesce(
    (
      select 'super_admin' = any(p.roles)
          or coalesce(p.permissions -> 'kasir' ->> 'lintas_kasir', 'false') = 'true'
      from e_pos.profiles p
      where p.id = auth.uid() and p.is_active = true
    ),
    false
  );
$$;


--
-- Name: FUNCTION current_role_lintas_kasir(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.current_role_lintas_kasir() IS 'True kalau user login boleh lihat/kelola shift & held-order kasir lain (izin kasir.lintas_kasir atau Super Admin). Migration 038.';


--
-- Name: customer_transaction_links(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.customer_transaction_links() RETURNS TABLE(transaction_id uuid, customer_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  with active_customers as (
    select id, lower(btrim(name)) as name_key, e_pos.normalize_phone(phone) as phone_key
    from e_pos.customers
    where is_active = true
  ),
  unique_names as (
    select name_key, (array_agg(id))[1] as id
    from active_customers
    group by name_key
    having count(*) = 1
  ),
  by_phone as (
    select t.id as transaction_id, (array_agg(c.id order by c.id))[1] as customer_id
    from e_pos.transactions t
    join active_customers c
      on c.phone_key is not null
     and c.phone_key = e_pos.normalize_phone(t.customer_phone)
    where t.deleted_at is null
    group by t.id
  ),
  by_name as (
    select t.id as transaction_id, u.id as customer_id
    from e_pos.transactions t
    join unique_names u on u.name_key = lower(btrim(t.customer_name))
    where t.deleted_at is null
      and e_pos.normalize_phone(t.customer_phone) is null
  )
  select transaction_id, customer_id from by_phone
  union
  select transaction_id, customer_id from by_name;
$$;


--
-- Name: enforce_profiles_role_change(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.enforce_profiles_role_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_caller_roles text[];
  v_caller_perms jsonb;
  v_caller_active boolean;
  v_caller_super boolean;
  v_old_super boolean;
  v_new_super boolean;
  v_over text;
begin
  -- Tidak ada perubahan pada kolom yang dijaga -> lewat.
  if new.roles is not distinct from old.roles
     and new.permissions is not distinct from old.permissions
     and new.is_active = old.is_active then
    return new;
  end if;

  -- service role / SQL editor (tanpa auth.uid) dibiarkan.
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

  -- Jangan sampai sistem tanpa Super Admin aktif.
  if v_old_super and old.is_active
     and (not v_new_super or not new.is_active)
     and not exists (
       select 1 from e_pos.profiles o
       where o.id <> old.id and o.is_active = true and 'super_admin' = any(o.roles)
     ) then
    raise exception 'Tidak bisa menurunkan atau menonaktifkan Super Admin terakhir'
      using errcode = '42501';
  end if;

  -- Super Admin: bebas.
  if v_caller_super then
    return new;
  end if;

  if not e_pos.has_permission_action('pengaturan_admin', 'edit') then
    raise exception 'Anda tidak punya izin mengubah role, hak akses, atau status user'
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
    raise exception 'Tidak bisa mengubah role, hak akses, atau status akun Anda sendiri'
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


--
-- Name: FUNCTION enforce_profiles_role_change(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.enforce_profiles_role_change() IS 'Migration 038: menegakkan aturan izin per user (Super Admin bebas; lainnya tidak boleh ubah akun sendiri, tidak boleh menambah izin yang tidak dimiliki, tidak boleh menyentuh Super Admin). Menggantikan hierarki level migration 028/031.';


--
-- Name: finalize_stock_opname(uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.finalize_stock_opname(p_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_session e_pos.stock_opname_sessions%rowtype;
  v_item e_pos.stock_opname_items%rowtype;
  v_product e_pos.products%rowtype;
  v_total integer;
  v_counted integer;
  v_old integer;
  v_delta integer;
  v_new integer;
  v_movement_id uuid;
  v_adjusted integer := 0;
  v_matched integer := 0;
  v_skipped integer := 0;
  v_plus bigint := 0;
  v_minus bigint := 0;
  v_value bigint := 0;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  select * into v_session from e_pos.stock_opname_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'Sesi opname #% sudah %',
      v_session.number,
      case v_session.status when 'completed' then 'selesai' else 'dibatalkan' end;
  end if;

  select count(*), count(counted_qty) into v_total, v_counted
  from e_pos.stock_opname_items where session_id = p_session_id;

  if v_counted = 0 then
    raise exception 'Belum ada produk yang dihitung. Hitung minimal satu produk sebelum menyelesaikan sesi.';
  end if;

  -- Urut per product_id: urutan kunci baris konsisten supaya tidak deadlock
  -- dengan transaksi penjualan / sesi lain.
  for v_item in
    select * from e_pos.stock_opname_items
    where session_id = p_session_id and counted_qty is not null
    order by product_id
  loop
    select * into v_product
    from e_pos.products
    where id = v_item.product_id and deleted_at is null
    for update;

    -- Produk sudah dihapus / berubah jadi jasa selama sesi: dilewati, bukan error.
    if not found or v_product.is_service = true or v_product.type = 'JASA' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_old := coalesce(v_product.stock, 0);
    v_delta := v_item.counted_qty - v_item.system_qty;
    v_new := v_old + v_delta;

    if v_new < 0 then
      raise exception 'Stok "%" akan minus (stok sekarang %, selisih opname %). Hitung ulang produk ini lalu selesaikan sesi lagi.',
        v_item.product_name, v_old, v_delta;
    end if;

    if v_delta <> 0 then
      update e_pos.products set stock = v_new, updated_at = now() where id = v_item.product_id;
    end if;

    -- Selisih 0 tetap dicatat sebagai bukti produk ini sudah diopname
    -- (sama seperti adjust_stock).
    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'opname', v_delta, null,
      'Opname sesi #' || v_session.number || coalesce(' — ' || v_item.note, ''),
      auth.uid()
    )
    returning id into v_movement_id;

    update e_pos.stock_opname_items
       set applied_delta = v_delta, movement_id = v_movement_id
     where id = v_item.id;

    if v_delta = 0 then
      v_matched := v_matched + 1;
    else
      v_adjusted := v_adjusted + 1;
      if v_delta > 0 then v_plus := v_plus + v_delta; else v_minus := v_minus + (-v_delta); end if;
      v_value := v_value + v_delta::bigint * coalesce(v_item.cost_price, 0);
    end if;
  end loop;

  update e_pos.stock_opname_sessions
     set status = 'completed', finalized_by = auth.uid(), finalized_at = now()
   where id = p_session_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'opname_finalize', 'stock_opname', p_session_id,
    jsonb_build_object(
      'opname_number', v_session.number,
      'session_name', v_session.name,
      'item_count', v_total,
      'counted_count', v_counted,
      'adjusted_count', v_adjusted,
      'matched_count', v_matched,
      'skipped_count', v_skipped,
      'plus_qty', v_plus,
      'minus_qty', v_minus,
      'diff_value', v_value,
      'note', format('Opname #%s (%s) selesai: %s produk disesuaikan, %s cocok, %s belum dihitung',
                     v_session.number, v_session.name, v_adjusted, v_matched, v_total - v_counted)
    )
  );

  return jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'number', v_session.number,
    'item_count', v_total,
    'counted_count', v_counted,
    'uncounted_count', v_total - v_counted,
    'adjusted_count', v_adjusted,
    'matched_count', v_matched,
    'skipped_count', v_skipped,
    'plus_qty', v_plus,
    'minus_qty', v_minus,
    'diff_value', v_value
  );
end;
$$;


--
-- Name: FUNCTION finalize_stock_opname(p_session_id uuid); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.finalize_stock_opname(p_session_id uuid) IS 'Selesaikan sesi opname: untuk tiap produk yang sudah dihitung, tambahkan (counted_qty - system_qty) ke stok sekarang dan tulis mutasi type opname. Produk belum dihitung tidak diubah. Atomik: kalau satu produk akan minus, seluruh penyelesaian dibatalkan dan sesi tetap draft. Butuh izin stok:edit.';


--
-- Name: get_customer_stats(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.get_customer_stats() RETURNS TABLE(customer_id uuid, trx_count bigint, total_spent bigint, last_trx_at timestamp with time zone, outstanding bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
begin
  if not e_pos.has_permission('pelanggan') then
    raise exception 'Tidak punya akses ke data pelanggan.';
  end if;

  return query
  select
    l.customer_id,
    count(*) filter (where t.status = 'PAID')::bigint,
    coalesce(sum(t.total) filter (where t.status = 'PAID'), 0)::bigint,
    max(t.created_at) filter (where t.status = 'PAID'),
    coalesce((
      select sum(p.amount)
      from e_pos.payments p
      join e_pos.transactions t2 on t2.id = p.transaction_id
      join e_pos.customer_transaction_links() l2 on l2.transaction_id = t2.id
      where l2.customer_id = l.customer_id
        and p.method = 'TEMPO'
        and p.is_settled = false
        and t2.status = 'PAID'
        and t2.deleted_at is null
    ), 0)::bigint
  from e_pos.customer_transaction_links() l
  join e_pos.transactions t on t.id = l.transaction_id
  group by l.customer_id;
end;
$$;


--
-- Name: get_customer_transactions(uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.get_customer_transactions(p_customer_id uuid) RETURNS TABLE(id uuid, receipt_no text, status text, total bigint, created_at timestamp with time zone, methods text, tempo_outstanding bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
begin
  if not e_pos.has_permission('pelanggan') then
    raise exception 'Tidak punya akses ke data pelanggan.';
  end if;

  return query
  select
    t.id,
    t.receipt_no,
    t.status::text,
    t.total::bigint,
    t.created_at,
    coalesce((
      select string_agg(distinct p.method::text, ' + ')
      from e_pos.payments p
      where p.transaction_id = t.id
    ), '-'),
    coalesce((
      select sum(p.amount)
      from e_pos.payments p
      where p.transaction_id = t.id
        and p.method = 'TEMPO'
        and p.is_settled = false
    ), 0)::bigint
  from e_pos.customer_transaction_links() l
  join e_pos.transactions t on t.id = l.transaction_id
  where l.customer_id = p_customer_id
  order by t.created_at desc
  limit 200;
end;
$$;


--
-- Name: get_screen_playlist(text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.get_screen_playlist(p_token text) RETURNS TABLE(id uuid, title text, media_type text, file_url text, duration_seconds integer, sort_order integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select m.id, m.title, m.media_type, m.file_url, m.duration_seconds, m.sort_order
  from e_pos.promo_media m
  join e_pos.promo_screens s on s.id = m.screen_id
  where s.access_token = p_token
    and s.is_active = true
    and m.is_active = true
  order by m.sort_order asc, m.id asc;
$$;


--
-- Name: FUNCTION get_screen_playlist(p_token text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.get_screen_playlist(p_token text) IS 'Satu-satunya jalan anon membaca media promosi (migration 027) — dipanggil app/tv/[access_token]/page.tsx (langkah berikutnya). Token salah ATAU layar nonaktif sama-sama menghasilkan 0 baris (tidak membedakan pesan, sengaja, lihat header migration).';


--
-- Name: get_transaction_by_receipt(text, date); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.get_transaction_by_receipt(p_receipt_no text, p_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_transaction record;
  v_items jsonb;
begin
  if p_receipt_no is null or trim(p_receipt_no) = '' or p_date is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Nomor struk dan tanggal transaksi wajib diisi.'
    );
  end if;

  select
    t.id,
    t.receipt_no,
    t.status,
    t.subtotal,
    t.discount,
    t.tax,
    t.total,
    t.customer_name,
    t.void_reason,
    t.related_transaction_id,
    t.created_at
  into v_transaction
  from e_pos.transactions t
  where t.receipt_no = trim(p_receipt_no)
    and (t.created_at at time zone 'Asia/Jakarta')::date = p_date
    and t.deleted_at is null
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Struk tidak ditemukan. Periksa kembali nomor struk dan tanggal transaksi.'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_name', ti.product_name,
        'unit', ti.unit,
        'qty', ti.qty,
        'returned_qty', ti.returned_qty,
        'unit_price', ti.unit_price,
        'subtotal', ti.subtotal
      )
      order by ti.created_at
    ),
    '[]'::jsonb
  )
  into v_items
  from e_pos.transaction_items ti
  where ti.transaction_id = v_transaction.id;

  return jsonb_build_object(
    'success', true,
    'receipt_no', v_transaction.receipt_no,
    'status', v_transaction.status,
    'created_at', v_transaction.created_at,
    'customer_name', v_transaction.customer_name,
    'subtotal', v_transaction.subtotal,
    'discount', v_transaction.discount,
    'tax', v_transaction.tax,
    'total', v_transaction.total,
    'void_reason', v_transaction.void_reason,
    'is_return_row', v_transaction.related_transaction_id is not null,
    'payment_method', (
      select p.method
      from e_pos.payments p
      where p.transaction_id = v_transaction.id
      order by p.created_at
      limit 1
    ),
    'items', v_items
  );
end;
$$;


--
-- Name: FUNCTION get_transaction_by_receipt(p_receipt_no text, p_date date); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.get_transaction_by_receipt(p_receipt_no text, p_date date) IS 'Lookup publik untuk halaman /cek-struk (PRD §4.9, §17 T-07). SECURITY DEFINER — sengaja bypass RLS lewat RPC yang divalidasi ketat (nomor struk + tanggal harus cocok), bukan lewat policy anon select langsung di transactions. Tidak pernah mengembalikan harga modal, nama kasir, atau detail bukti pembayaran.';


--
-- Name: give_gift(date, text, text, text, text, jsonb); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.give_gift(p_given_at date, p_recipient_name text, p_recipient_category text, p_occasion text, p_note text, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_date date := coalesce(p_given_at, (now() at time zone 'Asia/Jakarta')::date);
  v_recipient text := nullif(btrim(coalesce(p_recipient_name, '')), '');
  v_category text := coalesce(nullif(btrim(coalesce(p_recipient_category, '')), ''), 'lainnya');
  v_occasion text := nullif(btrim(coalesce(p_occasion, '')), '');
  v_dup uuid;
  v_gift_id uuid;
  v_number bigint;
  v_item record;
  v_product e_pos.products%rowtype;
  v_old integer;
  v_cost bigint;
  v_price bigint;
  v_movement_id uuid;
  v_item_count integer;
  v_total_qty bigint;
  v_total_cost bigint := 0;
  v_total_retail bigint := 0;
begin
  if not e_pos.has_permission_action('hadiah', 'create') then
    raise exception 'Anda tidak punya izin untuk mencatat hadiah';
  end if;

  if v_recipient is null then
    raise exception 'Nama penerima wajib diisi';
  end if;

  if v_category not in ('kyai', 'tamu_pondok', 'tamu_toko', 'lainnya') then
    raise exception 'Kategori penerima tidak valid';
  end if;

  if v_date > v_today then
    raise exception 'Tanggal hadiah tidak boleh di masa depan';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu produk yang dihadiahkan';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Maksimal 200 produk per hadiah';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) where product_id is null) then
    raise exception 'Ada baris tanpa produk';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) where qty is null or qty <= 0) then
    raise exception 'Jumlah hadiah harus berupa angka bulat lebih dari 0';
  end if;

  select product_id into v_dup
  from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer)
  group by product_id having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Produk yang sama muncul lebih dari satu kali. Gabungkan jumlahnya jadi satu baris.';
  end if;

  select count(*), sum(qty)
    into v_item_count, v_total_qty
  from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer);

  insert into e_pos.gift_records
    (given_at, recipient_name, recipient_category, occasion, note, item_count, total_qty, created_by)
  values (
    v_date, v_recipient, v_category, v_occasion,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_item_count, v_total_qty,
    (select id from e_pos.profiles where id = auth.uid())
  )
  returning id, number into v_gift_id, v_number;

  -- Urut per product_id: urutan kunci baris konsisten (anti-deadlock dengan penjualan / sesi lain).
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer) order by product_id
  loop
    select * into v_product
    from e_pos.products
    where id = v_item.product_id and deleted_at is null
    for update;

    if not found then
      raise exception 'Produk tidak ditemukan atau sudah dihapus';
    end if;
    if v_product.is_service = true or v_product.type = 'JASA' then
      raise exception 'Produk "%" adalah jasa — tidak punya stok untuk dihadiahkan', v_product.name;
    end if;

    v_old := coalesce(v_product.stock, 0);

    if v_old < v_item.qty then
      raise exception 'Stok "%" tidak cukup. Stok sekarang %, hadiah % unit.',
        v_product.name, v_old, v_item.qty;
    end if;

    v_cost := coalesce(v_product.cost_price, 0);
    v_price := coalesce(v_product.sell_price, 0);

    update e_pos.products
       set stock = v_old - v_item.qty,
           updated_at = now()
     where id = v_item.product_id;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'gift', -v_item.qty, v_gift_id,
      'Hadiah #' || v_number || ' — ' || v_recipient || coalesce(' (' || v_occasion || ')', ''),
      (select id from e_pos.profiles where id = auth.uid())
    )
    returning id into v_movement_id;

    insert into e_pos.gift_record_items
      (gift_id, product_id, product_name, product_sku, product_unit, qty, unit_cost, unit_price, movement_id)
    values
      (v_gift_id, v_item.product_id, v_product.name, v_product.sku, v_product.unit,
       v_item.qty, v_cost, v_price, v_movement_id);

    v_total_cost := v_total_cost + (v_item.qty::bigint * v_cost);
    v_total_retail := v_total_retail + (v_item.qty::bigint * v_price);
  end loop;

  update e_pos.gift_records
     set total_cost = v_total_cost,
         total_retail = v_total_retail
   where id = v_gift_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'gift_give', 'gift', v_gift_id,
    jsonb_build_object(
      'gift_number', v_number,
      'recipient', v_recipient,
      'category', v_category,
      'item_count', v_item_count,
      'total_qty', v_total_qty,
      'total_cost', v_total_cost,
      'note', format('Hadiah #%s untuk %s: %s produk, %s unit, nilai modal Rp %s',
                     v_number, v_recipient, v_item_count, v_total_qty, v_total_cost)
    )
  );

  return jsonb_build_object(
    'success', true,
    'gift_id', v_gift_id,
    'number', v_number,
    'item_count', v_item_count,
    'total_qty', v_total_qty,
    'total_cost', v_total_cost,
    'total_retail', v_total_retail
  );
end;
$$;


--
-- Name: FUNCTION give_gift(p_given_at date, p_recipient_name text, p_recipient_category text, p_occasion text, p_note text, p_items jsonb); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.give_gift(p_given_at date, p_recipient_name text, p_recipient_category text, p_occasion text, p_note text, p_items jsonb) IS 'Catat hadiah/oleh-oleh: kurangi stok tiap produk + tulis mutasi gift + dokumen hadiah (snapshot harga modal), atomik. Stok tidak boleh minus. Butuh izin hadiah:create.';


--
-- Name: has_permission(text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.has_permission(p_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select exists (
    select 1 from e_pos.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        'super_admin' = any(p.roles)
        or coalesce(p.permissions -> p_key ->> 'view', 'false') = 'true'
      )
  );
$$;


--
-- Name: FUNCTION has_permission(p_key text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.has_permission(p_key text) IS 'True kalau user login boleh Lihat modul tsb (profiles.permissions.<key>.view) atau Super Admin. Migration 038 (sebelumnya baca role_permissions); signature tidak berubah.';


--
-- Name: has_permission_action(text, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.has_permission_action(p_key text, p_action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select exists (
    select 1 from e_pos.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p_action in ('view', 'create', 'edit', 'delete')   -- aksi asing = ditolak (fail-closed)
      and (
        'super_admin' = any(p.roles)
        or (
          coalesce(p.permissions -> p_key ->> 'view', 'false') = 'true'
          and coalesce(p.permissions -> p_key ->> p_action, 'false') = 'true'
        )
      )
  );
$$;


--
-- Name: FUNCTION has_permission_action(p_key text, p_action text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.has_permission_action(p_key text, p_action text) IS 'Cek aksi granular (view/create/edit/delete) milik user login, atau Super Admin. Selalu mensyaratkan view=true. Migration 038 (sebelumnya baca role_permissions); signature tidak berubah.';


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
  select exists (
    select 1 from e_pos.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and 'super_admin' = any(p.roles)
  );
$$;


--
-- Name: FUNCTION is_super_admin(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.is_super_admin() IS 'True kalau user login aktif dan punya role super_admin. Migration 038.';


--
-- Name: log_initial_stock(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.log_initial_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
begin
  if coalesce(new.stock, 0) > 0 and coalesce(new.is_service, false) = false then
    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      new.id, 'initial', new.stock, null, 'Stok awal produk',
      -- created_by memakai FK ke profiles: kalau pemanggil bukan user biasa
      -- (mis. SQL Editor), isi NULL daripada membuat INSERT produk gagal.
      (select id from e_pos.profiles where id = auth.uid())
    );
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION log_initial_stock(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.log_initial_stock() IS 'Trigger AFTER INSERT di products: stok awal > 0 dicatat sebagai mutasi initial supaya ada jejak siapa yang mengisi stok awal.';


--
-- Name: loyalty_earn_unit(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.loyalty_earn_unit() RETURNS integer
    LANGUAGE sql STABLE
    AS $$ select 10000 $$;


--
-- Name: FUNCTION loyalty_earn_unit(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.loyalty_earn_unit() IS 'Kelipatan rupiah belanja (tunai/digital) untuk mendapat 1 poin. Nilai awal 10000 = placeholder, ubah sesuai kebijakan.';


--
-- Name: loyalty_point_value(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.loyalty_point_value() RETURNS integer
    LANGUAGE sql STABLE
    AS $$ select 100 $$;


--
-- Name: FUNCTION loyalty_point_value(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.loyalty_point_value() IS 'Nilai 1 poin saat dipakai sebagai potongan (rupiah). Harus sama dengan LOYALTY_POINT_VALUE di aplikasi.';


--
-- Name: normalize_phone(text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.normalize_phone(p_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when p_phone is null then null
    when regexp_replace(p_phone, '\D', '', 'g') = '' then null
    when regexp_replace(p_phone, '\D', '', 'g') like '62%'
      then regexp_replace(p_phone, '\D', '', 'g')
    when regexp_replace(p_phone, '\D', '', 'g') like '0%'
      then '62' || substr(regexp_replace(p_phone, '\D', '', 'g'), 2)
    else regexp_replace(p_phone, '\D', '', 'g')
  end;
$$;


--
-- Name: perms_added_beyond(jsonb, jsonb, jsonb); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.perms_added_beyond(p_new jsonb, p_old jsonb, p_caller jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select m.key || '.' || a.key
  from jsonb_each(case when jsonb_typeof(p_new) = 'object' then p_new else '{}'::jsonb end) m,
       lateral jsonb_each_text(case when jsonb_typeof(m.value) = 'object' then m.value else '{}'::jsonb end) a
  where a.value = 'true'
    and coalesce(p_old    -> m.key ->> a.key, 'false') <> 'true'
    and coalesce(p_caller -> m.key ->> a.key, 'false') <> 'true'
  order by m.key, a.key
  limit 1;
$$;


--
-- Name: FUNCTION perms_added_beyond(p_new jsonb, p_old jsonb, p_caller jsonb); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.perms_added_beyond(p_new jsonb, p_old jsonb, p_caller jsonb) IS 'Izin pertama yang ditambahkan tetapi tidak dimiliki pemberi (modul.aksi), atau NULL. Migration 038, port dari Monitoring Konveksi migration 019.';


--
-- Name: receive_stock(date, text, text, text, jsonb, boolean); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.receive_stock(p_received_at date, p_supplier text, p_reference_no text, p_note text, p_items jsonb, p_update_cost boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_date date := coalesce(p_received_at, (now() at time zone 'Asia/Jakarta')::date);
  v_supplier text := nullif(btrim(coalesce(p_supplier, '')), '');
  v_dup uuid;
  v_receipt_id uuid;
  v_number bigint;
  v_item record;
  v_product e_pos.products%rowtype;
  v_old integer;
  v_movement_id uuid;
  v_item_count integer;
  v_total_qty bigint;
  v_total_cost bigint;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk mencatat barang masuk';
  end if;

  if v_date > v_today then
    raise exception 'Tanggal terima tidak boleh di masa depan';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu produk yang masuk';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Maksimal 500 produk per barang masuk';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) where product_id is null) then
    raise exception 'Ada baris tanpa produk';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) where qty is null or qty <= 0) then
    raise exception 'Jumlah barang masuk harus berupa angka bulat lebih dari 0';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) where unit_cost is not null and unit_cost < 0) then
    raise exception 'Harga beli tidak boleh negatif';
  end if;

  select product_id into v_dup from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) group by product_id having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Produk yang sama muncul lebih dari satu kali. Gabungkan jumlahnya jadi satu baris.';
  end if;

  select count(*), sum(qty), coalesce(sum(qty::bigint * coalesce(unit_cost, 0)), 0)
    into v_item_count, v_total_qty, v_total_cost
  from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint);

  insert into e_pos.stock_receipts
    (received_at, supplier, reference_no, note, item_count, total_qty, total_cost, cost_updated, created_by)
  values (
    v_date, v_supplier,
    nullif(btrim(coalesce(p_reference_no, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_item_count, v_total_qty, v_total_cost, coalesce(p_update_cost, false), auth.uid()
  )
  returning id, number into v_receipt_id, v_number;

  -- Urut per product_id: urutan kunci baris konsisten (anti-deadlock dengan penjualan / sesi lain).
  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty integer, unit_cost bigint) order by product_id loop
    select * into v_product
    from e_pos.products
    where id = v_item.product_id and deleted_at is null
    for update;

    if not found then
      raise exception 'Produk tidak ditemukan atau sudah dihapus';
    end if;
    if v_product.is_service = true or v_product.type = 'JASA' then
      raise exception 'Produk "%" adalah jasa — tidak punya stok', v_product.name;
    end if;

    v_old := coalesce(v_product.stock, 0);

    update e_pos.products
       set stock = v_old + v_item.qty,
           cost_price = case
             when coalesce(p_update_cost, false) and v_item.unit_cost is not null then v_item.unit_cost
             else cost_price
           end,
           updated_at = now()
     where id = v_item.product_id;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'stock_in', v_item.qty, null,
      'Barang masuk #' || v_number || coalesce(' — ' || v_supplier, ''),
      auth.uid()
    )
    returning id into v_movement_id;

    insert into e_pos.stock_receipt_items
      (receipt_id, product_id, product_name, product_sku, product_unit, qty, unit_cost, movement_id)
    values
      (v_receipt_id, v_item.product_id, v_product.name, v_product.sku, v_product.unit,
       v_item.qty, v_item.unit_cost, v_movement_id);
  end loop;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'stock_receive', 'stock_receipt', v_receipt_id,
    jsonb_build_object(
      'receipt_number', v_number,
      'supplier', v_supplier,
      'item_count', v_item_count,
      'total_qty', v_total_qty,
      'total_cost', v_total_cost,
      'note', format('Barang masuk #%s%s: %s produk, %s unit', v_number,
                     coalesce(' (' || v_supplier || ')', ''), v_item_count, v_total_qty)
    )
  );

  return jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'number', v_number,
    'item_count', v_item_count,
    'total_qty', v_total_qty,
    'total_cost', v_total_cost
  );
end;
$$;


--
-- Name: FUNCTION receive_stock(p_received_at date, p_supplier text, p_reference_no text, p_note text, p_items jsonb, p_update_cost boolean); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.receive_stock(p_received_at date, p_supplier text, p_reference_no text, p_note text, p_items jsonb, p_update_cost boolean) IS 'Catat barang masuk: tambah stok tiap produk + tulis mutasi stock_in + dokumen penerimaan, atomik. Harga modal produk hanya diubah kalau p_update_cost = true. Butuh izin stok:edit.';


--
-- Name: redeem_loyalty_points(uuid, integer); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.redeem_loyalty_points(p_customer_id uuid, p_points integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_current integer;
  v_after integer;
begin
  if p_points <= 0 then
    return;
  end if;

  select loyalty_points into v_current
  from e_pos.customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'Pelanggan tidak ditemukan.';
  end if;

  if v_current < p_points then
    raise exception 'Poin tidak cukup. Tersedia %, diminta %', v_current, p_points;
  end if;

  v_after := v_current - p_points;

  update e_pos.customers
  set loyalty_points = v_after,
      updated_at = now()
  where id = p_customer_id;

  insert into e_pos.customer_point_logs
    (customer_id, type, points_delta, balance_after, reason, created_by)
  values
    (p_customer_id, 'redeem', -p_points, v_after, 'Dipakai sebagai potongan di Kasir', auth.uid());
end;
$$;


--
-- Name: FUNCTION redeem_loyalty_points(p_customer_id uuid, p_points integer); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.redeem_loyalty_points(p_customer_id uuid, p_points integer) IS 'Kurangi poin loyalitas pelanggan secara atomik (row lock + validasi cukup). Dipanggil Kasir setelah transaksi dengan potongan poin berhasil disimpan.';


--
-- Name: reorder_promo_media(uuid[]); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.reorder_promo_media(p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
begin
  if not e_pos.has_permission_action('promo', 'edit') then
    raise exception 'Anda tidak punya izin mengatur urutan media promosi.'
      using errcode = '42501';
  end if;

  update e_pos.promo_media m
     set sort_order = t.pos::integer
    from unnest(p_ids) with ordinality as t(id, pos)
   where m.id = t.id;
end;
$$;


--
-- Name: FUNCTION reorder_promo_media(p_ids uuid[]); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.reorder_promo_media(p_ids uuid[]) IS 'Migration 031: gate diganti ke has_permission_action(''promo'',''edit'') (mengurutkan ulang adalah bentuk "ubah", bukan tambah/hapus).';


--
-- Name: restore_product(uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.restore_product(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_product record;
begin
  if not e_pos.has_permission_action('sampah', 'edit') then
    raise exception 'Anda tidak punya izin untuk memulihkan produk';
  end if;

  select id, name, deleted_at into v_product
  from e_pos.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;

  if v_product.deleted_at is null then
    raise exception 'Produk tidak sedang ada di Sampah';
  end if;

  update e_pos.products
  set deleted_at = null, updated_at = now()
  where id = p_product_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_restore', 'product', p_product_id,
    jsonb_build_object('product_name', v_product.name)
  );

  return jsonb_build_object('success', true, 'product_id', p_product_id);
end;
$$;


--
-- Name: FUNCTION restore_product(p_product_id uuid); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.restore_product(p_product_id uuid) IS 'Pulihkan produk dari Sampah. Migration 031: gate diganti ke has_permission_action(''sampah'',''edit'') — pemulihan diperlakukan sebagai aksi "Ubah" menu Sampah (pecahan granular dari has_permission(''sampah'') migration 030).';


--
-- Name: restore_transaction(uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.restore_transaction(p_transaction_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_tx record;
begin
  if not e_pos.has_permission_action('sampah', 'edit') then
    raise exception 'Anda tidak punya izin untuk memulihkan transaksi';
  end if;

  select id, receipt_no, deleted_at into v_tx
  from e_pos.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_tx.deleted_at is null then
    raise exception 'Transaksi tidak sedang ada di Sampah';
  end if;

  update e_pos.transactions
  set deleted_at = null, updated_at = now()
  where id = p_transaction_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'transaction_restore', 'transaction', p_transaction_id,
    jsonb_build_object('receipt_no', v_tx.receipt_no)
  );

  return jsonb_build_object('success', true, 'transaction_id', p_transaction_id);
end;
$$;


--
-- Name: FUNCTION restore_transaction(p_transaction_id uuid); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.restore_transaction(p_transaction_id uuid) IS 'Pulihkan transaksi dari Sampah. Migration 031: gate diganti ke has_permission_action(''sampah'',''edit'') (pecahan granular dari has_permission(''sampah'') migration 030).';


--
-- Name: return_transaction(uuid, jsonb, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.return_transaction(p_transaction_id uuid, p_items jsonb, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_status e_pos.transaction_status;
  v_related uuid;
  v_sale_subtotal bigint;
  v_sale_total bigint;
  v_factor numeric;
  v_prev_refunded bigint;
  v_item jsonb;
  v_ti record;
  v_qty integer;
  v_refund_total bigint := 0;
  v_line_refund bigint;
  v_cap_left bigint;
  v_return_id uuid;
  v_sequence bigint;
  v_receipt_no text;
  v_shift_id uuid;
  v_paid_cash bigint := 0;
  v_paid_digital bigint := 0;
  v_paid_all bigint := 0;
  v_refund_cash bigint := 0;
  v_refund_digital bigint := 0;
  v_refund_unrecorded bigint := 0;
  -- ── TAMBAHAN (039) ── poin
  v_customer_id uuid;
  v_points_earned integer;
  v_points_redeemed integer;
  v_gross_returned numeric;
  v_ratio numeric;
  v_target integer;
  v_already integer;
  v_balance integer;
  v_rev integer;
  v_back integer;
  v_points_reversed integer := 0;
  v_points_returned integer := 0;
begin
  if not e_pos.has_permission_action('retur_void', 'create') then
    raise exception 'Anda tidak punya izin untuk retur transaksi';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Alasan retur wajib diisi';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
  then
    raise exception 'Pilih minimal 1 item untuk diretur';
  end if;

  select status, related_transaction_id, subtotal, total,
         customer_id, points_earned, points_redeemed
  into v_status, v_related, v_sale_subtotal, v_sale_total,
       v_customer_id, v_points_earned, v_points_redeemed
  from e_pos.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  -- Baris retur itu sendiri (related_transaction_id terisi) tidak boleh
  -- diretur lagi. Transaksi penjualan boleh PAID atau sudah pernah diretur
  -- sebagian (RETURN) — sisa qty dijaga per item di bawah.
  if v_related is not null or v_status not in ('PAID', 'RETURN') then
    raise exception 'Hanya transaksi penjualan berstatus PAID atau RETURN (sebagian) yang bisa diretur';
  end if;

  -- Faktor proporsional: yang dibayar pelanggan dibanding jumlah subtotal item.
  v_factor := case
    when v_sale_subtotal is not null and v_sale_subtotal > 0
      then v_sale_total::numeric / v_sale_subtotal
    else 1
  end;

  -- Total refund dari retur-retur sebelumnya (kolom subtotal baris RETURN
  -- menyimpan nilai refund positif — lihat insert di bawah).
  select coalesce(sum(subtotal), 0)
  into v_prev_refunded
  from e_pos.transactions
  where related_transaction_id = p_transaction_id
    and status = 'RETURN';

  -- Nomor struk retur dibuat lebih awal supaya baris retur bisa dibuat
  -- sebelum item-itemnya (item butuh transaction_id baris retur).
  select coalesce(max(split_part(receipt_no, '/', 4)::bigint), 0) + 1
  into v_sequence
  from e_pos.transactions
  where receipt_no like
    'LCO-RTR/' || to_char(now(), 'YY') || '/' || to_char(now(), 'MM') || '/%';

  v_receipt_no :=
    'LCO-RTR/' || to_char(now(), 'YY') || '/' || to_char(now(), 'MM')
    || '/' || lpad(v_sequence::text, 6, '0');

  -- Shift kasir yang sedang buka (kalau ada).
  if auth.uid() is not null then
    select id into v_shift_id
    from e_pos.shift_sessions
    where cashier_id = auth.uid()
      and status = 'OPEN'
    limit 1;
  end if;

  -- Baris retur dibuat dulu dengan angka sementara 0; total diisi di akhir
  -- setelah semua item dihitung (dalam satu transaksi database, jadi aman).
  insert into e_pos.transactions (
    receipt_no, status, subtotal, discount, tax, total,
    cashier_id, shift_id, void_reason, related_transaction_id
  )
  values (
    v_receipt_no, 'RETURN', 0, 0, 0, 0,
    auth.uid(), v_shift_id, p_reason, p_transaction_id
  )
  returning id into v_return_id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    select id, product_id, sku, product_name, unit, unit_price,
           qty, subtotal, returned_qty
    into v_ti
    from e_pos.transaction_items
    where id = (v_item->>'transaction_item_id')::uuid
      and transaction_id = p_transaction_id
    for update;

    if not found then
      raise exception 'Item transaksi tidak ditemukan: %', v_item->>'transaction_item_id';
    end if;

    v_qty := (v_item->>'qty')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty retur tidak valid untuk item %', v_ti.id;
    end if;

    if v_ti.returned_qty + v_qty > v_ti.qty then
      raise exception 'Qty retur melebihi sisa qty yang bisa diretur untuk item %', v_ti.id;
    end if;

    v_line_refund := round((v_ti.subtotal::numeric / v_ti.qty) * v_qty * v_factor);

    -- Batas atas: total semua retur tidak boleh melebihi total transaksi
    -- asli (menjaga dari selisih pembulatan rupiah).
    v_cap_left := greatest(v_sale_total - v_prev_refunded - v_refund_total, 0);
    v_line_refund := least(v_line_refund, v_cap_left);

    v_refund_total := v_refund_total + v_line_refund;

    update e_pos.transaction_items
    set returned_qty = returned_qty + v_qty
    where id = v_ti.id;

    insert into e_pos.transaction_items (
      transaction_id, product_id, sku, product_name, qty, unit,
      unit_price, discount, subtotal
    )
    values (
      v_return_id, v_ti.product_id, v_ti.sku, v_ti.product_name, v_qty,
      v_ti.unit, v_ti.unit_price, 0, v_line_refund
    );

    if v_ti.product_id is not null then
      update e_pos.products
      set stock = stock + v_qty, updated_at = now()
      where id = v_ti.product_id and is_service = false;

      insert into e_pos.stock_movements (
        product_id, type, qty_delta, reference_id, reason, created_by
      )
      values (
        v_ti.product_id, 'return', v_qty, p_transaction_id, p_reason, auth.uid()
      );
    end if;
  end loop;

  -- Pembagian refund menurut komposisi pembayaran asli.
  select
    coalesce(sum(amount) filter (where method = 'CASH'), 0),
    coalesce(sum(amount) filter (where method = 'DIGITAL'), 0),
    coalesce(sum(amount), 0)
  into v_paid_cash, v_paid_digital, v_paid_all
  from e_pos.payments
  where transaction_id = p_transaction_id;

  if v_paid_all > 0 and v_refund_total > 0 then
    v_refund_cash := round(v_refund_total::numeric * v_paid_cash / v_paid_all);
    v_refund_digital := round(v_refund_total::numeric * v_paid_digital / v_paid_all);
    v_refund_unrecorded := v_refund_total - v_refund_cash - v_refund_digital;
  else
    v_refund_unrecorded := v_refund_total;
  end if;

  if v_refund_cash > 0 and v_shift_id is null and auth.uid() is not null then
    raise exception 'Retur ini mengembalikan uang tunai. Buka shift kasir terlebih dahulu.';
  end if;

  if v_refund_cash > 0 then
    insert into e_pos.payments (transaction_id, method, amount, notes)
    values (v_return_id, 'CASH', -v_refund_cash, 'Refund tunai retur ' || v_receipt_no);
  end if;

  if v_refund_digital > 0 then
    insert into e_pos.payments (transaction_id, method, amount, notes)
    values (
      v_return_id, 'DIGITAL', -v_refund_digital,
      'Refund digital retur ' || v_receipt_no || ' (pengembalian dana diproses manual)'
    );
  end if;

  -- ── TAMBAHAN (039) ── Poin loyalti ikut retur.
  -- Porsi retur = nilai barang yang sudah diretur (KUMULATIF semua retur,
  -- termasuk yang sekarang) dibanding subtotal transaksi asli. Dengan hitungan
  -- kumulatif, retur sebagian berkali-kali tidak menumpuk selisih pembulatan:
  -- setelah semua barang diretur, total poin yang dicabut/dikembalikan pas
  -- sama dengan yang dulu didapat/dipakai.
  --   1. Poin yang DIDAPAT dari transaksi ini dicabut sebesar porsi retur.
  --      Kalau saldo pelanggan sudah lebih kecil (poinnya sudah terpakai),
  --      hanya sebesar saldo yang dicabut — saldo tidak pernah negatif.
  --      Sisanya dicoba lagi di retur berikutnya.
  --   2. Poin yang DIPAKAI sebagai potongan dikembalikan sebesar porsi retur.
  if v_customer_id is not null
     and (coalesce(v_points_earned, 0) > 0 or coalesce(v_points_redeemed, 0) > 0)
  then
    select coalesce(sum(subtotal::numeric / qty * returned_qty), 0)
    into v_gross_returned
    from e_pos.transaction_items
    where transaction_id = p_transaction_id;

    v_ratio := case
      when v_sale_subtotal > 0 then least(v_gross_returned / v_sale_subtotal, 1)
      else 0
    end;

    select loyalty_points into v_balance
    from e_pos.customers
    where id = v_customer_id
    for update;

    if found then

      if coalesce(v_points_earned, 0) > 0 then
        select coalesce(sum(-points_delta), 0) into v_already
        from e_pos.customer_point_logs
        where transaction_id = p_transaction_id and type = 'earn_return';

        v_target := round(v_points_earned * v_ratio);
        v_rev := least(greatest(v_target - v_already, 0), v_balance);

        if v_rev > 0 then
          v_balance := v_balance - v_rev;
          insert into e_pos.customer_point_logs (
            customer_id, type, points_delta, balance_after,
            reason, created_by, transaction_id
          )
          values (
            v_customer_id, 'earn_return', -v_rev, v_balance,
            'Poin belanja dicabut karena retur ' || v_receipt_no,
            auth.uid(), p_transaction_id
          );
          v_points_reversed := v_rev;
        end if;
      end if;

      if coalesce(v_points_redeemed, 0) > 0 then
        select coalesce(sum(points_delta), 0) into v_already
        from e_pos.customer_point_logs
        where transaction_id = p_transaction_id and type = 'redeem_return';

        v_target := round(v_points_redeemed * v_ratio);
        v_back := greatest(v_target - v_already, 0);

        if v_back > 0 then
          v_balance := v_balance + v_back;
          insert into e_pos.customer_point_logs (
            customer_id, type, points_delta, balance_after,
            reason, created_by, transaction_id
          )
          values (
            v_customer_id, 'redeem_return', v_back, v_balance,
            'Poin dipakai dikembalikan karena retur ' || v_receipt_no,
            auth.uid(), p_transaction_id
          );
          v_points_returned := v_back;
        end if;
      end if;

      if v_points_reversed > 0 or v_points_returned > 0 then
        update e_pos.customers
        set loyalty_points = v_balance, updated_at = now()
        where id = v_customer_id;
      end if;

    end if;
  end if;

  update e_pos.transactions
  set subtotal = v_refund_total,
      total = -v_refund_total,
      updated_at = now()
  where id = v_return_id;

  update e_pos.transactions
  set status = 'RETURN', updated_at = now()
  where id = p_transaction_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'return_transaction', 'transaction', p_transaction_id,
    jsonb_build_object(
      'reason', p_reason,
      'return_transaction_id', v_return_id,
      'refund_amount', v_refund_total,
      'refund_cash', v_refund_cash,
      'refund_digital', v_refund_digital,
      'refund_not_recorded', v_refund_unrecorded,
      'points_reversed', v_points_reversed,
      'points_returned', v_points_returned
    )
  );

  return jsonb_build_object(
    'success', true,
    'return_transaction_id', v_return_id,
    'receipt_no', v_receipt_no,
    'refund_amount', v_refund_total,
    'refund_cash', v_refund_cash,
    'refund_digital', v_refund_digital,
    'refund_not_recorded', v_refund_unrecorded,
    'points_reversed', v_points_reversed,
    'points_returned', v_points_returned
  );
end;
$$;


--
-- Name: FUNCTION return_transaction(p_transaction_id uuid, p_items jsonb, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.return_transaction(p_transaction_id uuid, p_items jsonb, p_reason text) IS 'Retur sebagian/total transaksi penjualan (PAID atau RETURN sebagian). Migration 037: item retur di transaction_items, retur berulang, refund proporsional, refund CASH/DIGITAL tercatat di payments + shift. Migration 039: poin didapat dicabut & poin dipakai dikembalikan secara proporsional. Gate: has_permission_action(''retur_void'',''create'').';


--
-- Name: save_opname_count(uuid, uuid, text, integer, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.save_opname_count(p_session_id uuid, p_product_id uuid, p_mode text, p_qty integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_session e_pos.stock_opname_sessions%rowtype;
  v_item e_pos.stock_opname_items%rowtype;
  v_stock integer;
  v_new integer;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  if p_mode is null or p_mode not in ('set', 'add', 'clear', 'note') then
    raise exception 'Mode hitungan tidak valid';
  end if;

  select * into v_session from e_pos.stock_opname_sessions where id = p_session_id for share;
  if not found then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'Sesi opname #% sudah %, hitungan tidak bisa diubah lagi',
      v_session.number,
      case v_session.status when 'completed' then 'selesai' else 'dibatalkan' end;
  end if;

  select * into v_item
  from e_pos.stock_opname_items
  where session_id = p_session_id and product_id = p_product_id
  for update;
  if not found then
    raise exception 'Produk ini tidak termasuk dalam sesi opname';
  end if;

  if p_mode = 'note' then
    update e_pos.stock_opname_items
       set note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_item.id
    returning * into v_item;
  else
    select coalesce(stock, 0) into v_stock from e_pos.products where id = p_product_id;
    v_stock := coalesce(v_stock, v_item.system_qty);

    if p_mode = 'clear' then
      update e_pos.stock_opname_items
         set counted_qty = null, system_qty = v_stock, counted_by = null, counted_at = null,
             note = case when p_note is null then note else nullif(btrim(p_note), '') end
       where id = v_item.id
      returning * into v_item;
    else
      if p_qty is null then
        raise exception 'Jumlah tidak boleh kosong';
      end if;

      v_new := case when p_mode = 'add' then coalesce(v_item.counted_qty, 0) + p_qty else p_qty end;
      if v_new < 0 then
        raise exception 'Hasil hitung fisik tidak boleh negatif';
      end if;

      update e_pos.stock_opname_items
         set counted_qty = v_new, system_qty = v_stock,
             counted_by = auth.uid(), counted_at = now(),
             note = case when p_note is null then note else nullif(btrim(p_note), '') end
       where id = v_item.id
      returning * into v_item;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'product_id', v_item.product_id,
    'system_qty', v_item.system_qty,
    'counted_qty', v_item.counted_qty,
    'note', v_item.note,
    'counted_at', v_item.counted_at
  );
end;
$$;


--
-- Name: FUNCTION save_opname_count(p_session_id uuid, p_product_id uuid, p_mode text, p_qty integer, p_note text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.save_opname_count(p_session_id uuid, p_product_id uuid, p_mode text, p_qty integer, p_note text) IS 'Simpan hitungan fisik satu produk dalam sesi draft. Mencatat stok sistem pada saat itu (system_qty) supaya penjualan selama opname tidak dianggap selisih. Mode: set / add / clear / note. Butuh izin stok:edit.';


--
-- Name: set_customer_active(uuid, boolean); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.set_customer_active(p_customer_id uuid, p_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
begin
  if not e_pos.has_permission_action('pelanggan', 'delete') then
    raise exception 'Anda tidak punya izin mengarsipkan pelanggan.';
  end if;

  update e_pos.customers
  set is_active = p_active,
      updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Pelanggan tidak ditemukan.';
  end if;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    case when p_active then 'restore_customer' else 'archive_customer' end,
    'customer', p_customer_id, null
  );
end;
$$;


--
-- Name: settle_receivable(uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.settle_receivable(p_payment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_payment record;
  v_active boolean;
begin
  select true into v_active
  from e_pos.profiles
  where id = auth.uid() and is_active = true;

  if v_active is distinct from true then
    raise exception 'Anda tidak punya izin untuk mencatat pelunasan';
  end if;

  select id, method, is_settled
  into v_payment
  from e_pos.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Data pembayaran tidak ditemukan';
  end if;

  if v_payment.method <> 'TEMPO' then
    raise exception 'Hanya pembayaran TEMPO yang bisa ditandai lunas';
  end if;

  if v_payment.is_settled then
    raise exception 'Piutang ini sudah ditandai lunas sebelumnya';
  end if;

  update e_pos.payments
  set is_settled = true,
      settled_at = now(),
      settled_by = auth.uid()
  where id = p_payment_id;

  return jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'settled_at', now()
  );
end;
$$;


--
-- Name: FUNCTION settle_receivable(p_payment_id uuid); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.settle_receivable(p_payment_id uuid) IS 'Satu-satunya jalur menandai piutang TEMPO lunas (PRD §17 T-08, §4.7). SECURITY DEFINER karena payments tidak punya policy update langsung (migration 011). Role: SEMUA user aktif boleh — lihat catatan keputusan #3 di header migration ini, ubah di sini kalau PRD ternyata membatasi ke role tertentu.';


--
-- Name: shift_cash_totals(uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.shift_cash_totals(p_shift_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_opening bigint;
  v_sales   bigint;
  v_refunds bigint;
  v_voided  bigint;
  v_in      bigint;
  v_out     bigint;
begin
  select opening_cash into v_opening
  from shift_sessions
  where id = p_shift_id;

  if not found then
    raise exception 'Shift tidak ditemukan';
  end if;

  -- Pembayaran TUNAI pada transaksi shift ini. Nilai positif = penjualan,
  -- nilai negatif = refund tunai retur (migration 037). Transaksi VOID
  -- dikeluarkan dari hitungan (lihat catatan header) dan dilaporkan terpisah.
  select
    coalesce(sum(pay.amount) filter (where pay.amount > 0 and t.status <> 'VOID'), 0),
    coalesce(-sum(pay.amount) filter (where pay.amount < 0 and t.status <> 'VOID'), 0),
    coalesce(sum(pay.amount) filter (where pay.amount > 0 and t.status = 'VOID'), 0)
  into v_sales, v_refunds, v_voided
  from payments pay
  join transactions t on t.id = pay.transaction_id
  where t.shift_id = p_shift_id
    and pay.method = 'CASH';

  select
    coalesce(sum(amount) filter (where type = 'IN'), 0),
    coalesce(sum(amount) filter (where type = 'OUT'), 0)
  into v_in, v_out
  from cash_movements
  where shift_id = p_shift_id
    and voided_at is null;

  return jsonb_build_object(
    'opening_cash',  v_opening,
    'cash_sales',    v_sales,
    'cash_refunds',  v_refunds,
    'cash_voided',   v_voided,
    'cash_in',       v_in,
    'cash_out',      v_out,
    'expected_cash', v_opening + v_sales - v_refunds + v_in - v_out
  );
end;
$$;


--
-- Name: FUNCTION shift_cash_totals(p_shift_id uuid); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.shift_cash_totals(p_shift_id uuid) IS 'INTERNAL (migration 040): rumus kas seharusnya satu shift = modal awal + penjualan tunai - refund tunai + kas masuk - kas keluar. Transaksi VOID dikeluarkan (dilaporkan sbg cash_voided). Tidak diberi hak execute ke client agar angka seharusnya tidak bocor sebelum tutup shift.';


--
-- Name: soft_delete_product(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.soft_delete_product(p_product_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_product record;
begin
  if not e_pos.has_permission_action('produk', 'delete') then
    raise exception 'Anda tidak punya izin untuk menghapus produk';
  end if;

  select id, name, deleted_at into v_product
  from e_pos.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;

  if v_product.deleted_at is not null then
    raise exception 'Produk sudah ada di Sampah';
  end if;

  update e_pos.products
  set deleted_at = now(), updated_at = now()
  where id = p_product_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'product_delete', 'product', p_product_id,
    jsonb_build_object('product_name', v_product.name, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('success', true, 'product_id', p_product_id);
end;
$$;


--
-- Name: FUNCTION soft_delete_product(p_product_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.soft_delete_product(p_product_id uuid, p_reason text) IS 'Soft-delete produk (isi deleted_at). Migration 031: gate DIPINDAH dari has_permission(''sampah'') ke has_permission_action(''produk'',''delete'') — lihat CATATAN KHUSUS di header migration ini soal mismatch frontend/backend yang diperbaiki di sini. Logika lain tidak berubah dari migration 030.';


--
-- Name: soft_delete_transaction(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.soft_delete_transaction(p_transaction_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_tx record;
begin
  -- Belum ada pemanggil di frontend manapun sampai migration ini ditulis
  -- (dicek ulang, lihat catatan header) — tetap digate ke aksi 'edit' menu
  -- Sampah (sama dengan restore_*) sampai ada keputusan produk menu mana
  -- yang akan memilikinya kalau fiturnya benar-benar dibangun nanti.
  if not e_pos.has_permission_action('sampah', 'edit') then
    raise exception 'Anda tidak punya izin untuk menghapus transaksi';
  end if;

  select id, receipt_no, deleted_at into v_tx
  from e_pos.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_tx.deleted_at is not null then
    raise exception 'Transaksi sudah ada di Sampah';
  end if;

  update e_pos.transactions
  set deleted_at = now(), updated_at = now()
  where id = p_transaction_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'transaction_delete', 'transaction', p_transaction_id,
    jsonb_build_object('receipt_no', v_tx.receipt_no, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('success', true, 'transaction_id', p_transaction_id);
end;
$$;


--
-- Name: FUNCTION soft_delete_transaction(p_transaction_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.soft_delete_transaction(p_transaction_id uuid, p_reason text) IS 'Soft-delete transaksi. Migration 031: gate diganti ke has_permission_action(''sampah'',''edit'') apa adanya (lihat catatan di badan fungsi) — belum ada pemanggil di frontend.';


--
-- Name: start_stock_opname(text, uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.start_stock_opname(p_name text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_category_name text;
  v_session_id uuid;
  v_number bigint;
  v_item_count integer;
  v_conflict bigint;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk melakukan opname stok';
  end if;

  if p_category_id is not null then
    select name into v_category_name from e_pos.categories where id = p_category_id;
    if not found then
      raise exception 'Kategori tidak ditemukan';
    end if;
  end if;

  -- Serialisasi pembuatan sesi supaya dua sesi tidak lolos cek tumpang tindih bersamaan.
  perform pg_advisory_xact_lock(hashtext('start_stock_opname'));

  select s.number into v_conflict
  from e_pos.stock_opname_items i
  join e_pos.stock_opname_sessions s on s.id = i.session_id
  join e_pos.products p on p.id = i.product_id
  where s.status = 'draft'
    and p.deleted_at is null
    and coalesce(p.is_service, false) = false
    and p.type <> 'JASA'
    and (p_category_id is null or p.category_id = p_category_id)
  order by s.number
  limit 1;

  if v_conflict is not null then
    raise exception 'Sebagian produk di cakupan ini masih ada di sesi opname #% yang belum selesai. Selesaikan atau batalkan sesi itu dulu.', v_conflict;
  end if;

  if v_name is null then
    v_name := 'Opname ' || to_char(now() at time zone 'Asia/Jakarta', 'DD-MM-YYYY');
  end if;

  insert into e_pos.stock_opname_sessions (name, category_id, category_name, note, created_by)
  values (v_name, p_category_id, v_category_name, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id, number into v_session_id, v_number;

  insert into e_pos.stock_opname_items
    (session_id, product_id, product_name, product_sku, product_barcode, product_unit, cost_price, system_qty)
  select
    v_session_id, p.id, p.name, p.sku, p.barcode, p.unit, p.cost_price, coalesce(p.stock, 0)
  from e_pos.products p
  where p.deleted_at is null
    and coalesce(p.is_service, false) = false
    and p.type <> 'JASA'
    and (p_category_id is null or p.category_id = p_category_id);

  get diagnostics v_item_count = row_count;

  if v_item_count = 0 then
    raise exception 'Tidak ada produk berstok pada cakupan ini';
  end if;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'opname_start', 'stock_opname', v_session_id,
    jsonb_build_object(
      'opname_number', v_number,
      'session_name', v_name,
      'category_name', v_category_name,
      'item_count', v_item_count,
      'note', format('Opname #%s (%s) dimulai, %s produk', v_number, v_name, v_item_count)
    )
  );

  return jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'number', v_number,
    'name', v_name,
    'item_count', v_item_count
  );
end;
$$;


--
-- Name: FUNCTION start_stock_opname(p_name text, p_category_id uuid, p_note text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.start_stock_opname(p_name text, p_category_id uuid, p_note text) IS 'Mulai sesi opname: salin semua produk fisik (tidak dihapus, bukan jasa) pada cakupan (semua / satu kategori) beserta stok sistem saat ini. Ditolak kalau ada produk yang sudah ada di sesi lain yang masih berjalan. Butuh izin stok:edit.';


--
-- Name: stock_movement_actors(); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.stock_movement_actors() RETURNS TABLE(user_id uuid, full_name text, movement_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
begin
  if not e_pos.has_permission_action('stok', 'view') then
    raise exception 'Anda tidak punya izin melihat mutasi stok';
  end if;

  return query
    select p.id, p.full_name, count(*)::bigint
    from e_pos.stock_movements m
    join e_pos.profiles p on p.id = m.created_by
    group by p.id, p.full_name
    order by p.full_name nulls last, p.id;
end;
$$;


--
-- Name: FUNCTION stock_movement_actors(); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.stock_movement_actors() IS 'User yang pernah membuat mutasi stok beserta jumlah mutasinya — untuk pilihan filter Oleh di Riwayat Mutasi. Butuh izin stok:view.';


--
-- Name: stock_movement_summary(timestamp with time zone, timestamp with time zone, uuid, text[], uuid); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.stock_movement_summary(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_product_id uuid DEFAULT NULL::uuid, p_types text[] DEFAULT NULL::text[], p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'e_pos'
    AS $$
declare
  v_masuk bigint;
  v_keluar bigint;
  v_jumlah bigint;
begin
  if not e_pos.has_permission_action('stok', 'view') then
    raise exception 'Anda tidak punya izin melihat mutasi stok';
  end if;

  select
    coalesce(sum(qty_delta) filter (where qty_delta > 0), 0),
    coalesce(abs(sum(qty_delta) filter (where qty_delta < 0)), 0),
    count(*)
  into v_masuk, v_keluar, v_jumlah
  from e_pos.stock_movements
  where (p_from is null or created_at >= p_from)
    and (p_to is null or created_at < p_to)
    and (p_product_id is null or product_id = p_product_id)
    and (p_user_id is null or created_by = p_user_id)
    and (p_types is null or cardinality(p_types) = 0 or type = any(p_types));

  return jsonb_build_object(
    'masuk', v_masuk,
    'keluar', v_keluar,
    'jumlah', v_jumlah
  );
end;
$$;


--
-- Name: FUNCTION stock_movement_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_product_id uuid, p_types text[], p_user_id uuid); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.stock_movement_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_product_id uuid, p_types text[], p_user_id uuid) IS 'Ringkasan mutasi stok sesuai filter: total masuk (qty_delta > 0), total keluar (qty_delta < 0, nilai mutlak), dan jumlah baris. p_to eksklusif. p_user_id opsional = hanya mutasi buatan user itu. Butuh izin stok:view.';


--
-- Name: void_cash_movement(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.void_cash_movement(p_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_m      record;
begin
  if v_uid is null then
    raise exception 'Harus login untuk membatalkan catatan kas.';
  end if;

  if not e_pos.has_permission_action('kasir', 'view') then
    raise exception 'Anda tidak punya izin membatalkan catatan kas.';
  end if;

  if char_length(v_reason) < 3 then
    raise exception 'Alasan pembatalan wajib diisi (minimal 3 karakter).';
  end if;

  select m.id, m.shift_id, m.type, m.amount, m.category, m.voided_at,
         s.status as shift_status, s.cashier_id as shift_cashier
  into v_m
  from cash_movements m
  join shift_sessions s on s.id = m.shift_id
  where m.id = p_id
  for update of m, s;

  if not found then
    raise exception 'Catatan kas tidak ditemukan.';
  end if;

  if v_m.voided_at is not null then
    raise exception 'Catatan kas ini sudah dibatalkan.';
  end if;

  if v_m.shift_status <> 'OPEN' then
    raise exception 'Shift sudah ditutup — catatan kas tidak bisa dibatalkan lagi.';
  end if;

  if v_m.shift_cashier <> v_uid and not e_pos.current_role_lintas_kasir() then
    raise exception 'Anda tidak berhak membatalkan catatan kas ini.';
  end if;

  update cash_movements
  set voided_at = now(),
      voided_by = v_uid,
      void_reason = v_reason
  where id = p_id;

  insert into activity_logs (user_id, action, entity, entity_id, meta)
  values (
    v_uid, 'cash_void', 'shift', v_m.shift_id,
    jsonb_build_object(
      'movement_id', p_id,
      'type', v_m.type,
      'amount', v_m.amount,
      'category', v_m.category,
      'reason', v_reason
    )
  );

  return jsonb_build_object('success', true, 'id', p_id);
end;
$$;


--
-- Name: FUNCTION void_cash_movement(p_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.void_cash_movement(p_id uuid, p_reason text) IS 'Batalkan catatan kas (soft). Hanya selama shift OPEN; pemilik shift atau role lintas-kasir. Migration 040.';


--
-- Name: void_gift(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.void_gift(p_gift_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_gift e_pos.gift_records%rowtype;
  v_item e_pos.gift_record_items%rowtype;
  v_product e_pos.products%rowtype;
  v_skipped integer := 0;
begin
  if not e_pos.has_permission_action('hadiah', 'delete') then
    raise exception 'Anda tidak punya izin untuk membatalkan hadiah';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan pembatalan wajib diisi';
  end if;

  select * into v_gift from e_pos.gift_records where id = p_gift_id for update;
  if not found then
    raise exception 'Hadiah tidak ditemukan';
  end if;
  if v_gift.status <> 'completed' then
    raise exception 'Hadiah #% sudah dibatalkan', v_gift.number;
  end if;

  for v_item in
    select * from e_pos.gift_record_items where gift_id = p_gift_id order by product_id
  loop
    select * into v_product
    from e_pos.products
    where id = v_item.product_id and deleted_at is null
    for update;

    -- Produk sudah dihapus: tidak ada stok yang bisa dikembalikan.
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update e_pos.products
       set stock = coalesce(v_product.stock, 0) + v_item.qty,
           updated_at = now()
     where id = v_item.product_id;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'gift', v_item.qty, p_gift_id,
      'Pembatalan hadiah #' || v_gift.number || ': ' || btrim(p_reason),
      (select id from e_pos.profiles where id = auth.uid())
    );
  end loop;

  update e_pos.gift_records
     set status = 'voided',
         voided_by = (select id from e_pos.profiles where id = auth.uid()),
         voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_gift_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'gift_void', 'gift', p_gift_id,
    jsonb_build_object(
      'gift_number', v_gift.number,
      'skipped_count', v_skipped,
      'reason', format('Hadiah #%s dibatalkan: %s', v_gift.number, btrim(p_reason))
    )
  );

  return jsonb_build_object(
    'success', true,
    'gift_id', p_gift_id,
    'number', v_gift.number,
    'skipped_count', v_skipped
  );
end;
$$;


--
-- Name: FUNCTION void_gift(p_gift_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.void_gift(p_gift_id uuid, p_reason text) IS 'Batalkan hadiah: stok dikembalikan (mutasi gift positif), dokumen jadi voided dan tidak dihitung di beban hadiah. Alasan wajib. Butuh izin hadiah:delete.';


--
-- Name: void_stock_receipt(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.void_stock_receipt(p_receipt_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_receipt e_pos.stock_receipts%rowtype;
  v_item e_pos.stock_receipt_items%rowtype;
  v_product e_pos.products%rowtype;
  v_old integer;
  v_skipped integer := 0;
begin
  if not e_pos.has_permission_action('stok', 'edit') then
    raise exception 'Anda tidak punya izin untuk membatalkan barang masuk';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan pembatalan wajib diisi';
  end if;

  select * into v_receipt from e_pos.stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Barang masuk tidak ditemukan';
  end if;
  if v_receipt.status <> 'completed' then
    raise exception 'Barang masuk #% sudah dibatalkan', v_receipt.number;
  end if;

  for v_item in
    select * from e_pos.stock_receipt_items where receipt_id = p_receipt_id order by product_id
  loop
    select * into v_product
    from e_pos.products
    where id = v_item.product_id and deleted_at is null
    for update;

    -- Produk sudah dihapus: tidak ada stok yang perlu dikurangi.
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_old := coalesce(v_product.stock, 0);

    if v_old < v_item.qty then
      raise exception 'Stok "%" tinggal %, tidak cukup untuk membatalkan barang masuk % unit (sebagian sudah terjual). Koreksi lewat Penyesuaian.',
        v_item.product_name, v_old, v_item.qty;
    end if;

    update e_pos.products set stock = v_old - v_item.qty, updated_at = now()
     where id = v_item.product_id;

    insert into e_pos.stock_movements (product_id, type, qty_delta, reference_id, reason, created_by)
    values (
      v_item.product_id, 'adjustment', -v_item.qty, null,
      'Pembatalan barang masuk #' || v_receipt.number || ': ' || btrim(p_reason),
      auth.uid()
    );
  end loop;

  update e_pos.stock_receipts
     set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
   where id = p_receipt_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'stock_receive_void', 'stock_receipt', p_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt.number,
      'skipped_count', v_skipped,
      'reason', format('Barang masuk #%s dibatalkan: %s', v_receipt.number, btrim(p_reason))
    )
  );

  return jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'number', v_receipt.number,
    'skipped_count', v_skipped
  );
end;
$$;


--
-- Name: FUNCTION void_stock_receipt(p_receipt_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.void_stock_receipt(p_receipt_id uuid, p_reason text) IS 'Batalkan barang masuk: kurangi stok sebesar yang dulu masuk (mutasi adjustment). Ditolak kalau stok sekarang tidak cukup. Harga modal yang pernah diperbarui tidak dikembalikan. Alasan wajib. Butuh izin stok:edit.';


--
-- Name: void_transaction(uuid, text); Type: FUNCTION; Schema: e_pos; Owner: -
--

CREATE FUNCTION e_pos.void_transaction(p_transaction_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'e_pos'
    AS $$
declare
  v_status e_pos.transaction_status;
  v_item record;
begin
  if not e_pos.has_permission_action('retur_void', 'delete') then
    raise exception 'Anda tidak punya izin untuk void transaksi';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Alasan void wajib diisi';
  end if;

  select status into v_status
  from e_pos.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_status <> 'PAID' then
    raise exception 'Hanya transaksi berstatus PAID yang bisa di-void';
  end if;

  for v_item in
    select product_id, (qty - returned_qty) as remaining_qty
    from e_pos.transaction_items
    where transaction_id = p_transaction_id
  loop
    if v_item.product_id is not null and v_item.remaining_qty > 0 then
      update e_pos.products
      set stock = stock + v_item.remaining_qty, updated_at = now()
      where id = v_item.product_id and is_service = false;

      insert into e_pos.stock_movements (
        product_id, type, qty_delta, reference_id, reason, created_by
      )
      values (
        v_item.product_id, 'void', v_item.remaining_qty, p_transaction_id, p_reason, auth.uid()
      );
    end if;
  end loop;

  update e_pos.transactions
  set status = 'VOID', void_reason = p_reason, updated_at = now()
  where id = p_transaction_id;

  insert into e_pos.activity_logs (user_id, action, entity, entity_id, meta)
  values (
    auth.uid(), 'void_transaction', 'transaction', p_transaction_id,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id
  );
end;
$$;


--
-- Name: FUNCTION void_transaction(p_transaction_id uuid, p_reason text); Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON FUNCTION e_pos.void_transaction(p_transaction_id uuid, p_reason text) IS 'Void transaksi PAID. Migration 031: gate diganti ke has_permission_action(''retur_void'',''delete'') — void diperlakukan sebagai aksi "Hapus" (membatalkan keabsahan transaksi), pecahan granular dari has_permission(''retur_void'') migration 030.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id uuid,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE activity_logs; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.activity_logs IS 'Audit trail aksi sensitif (void, retur, opname/adjustment stok, hapus & pulihkan produk/transaksi). Hanya ditulis dari dalam RPC security definer — lihat migration 014.';


--
-- Name: cash_movements; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.cash_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid NOT NULL,
    type text NOT NULL,
    amount bigint NOT NULL,
    category text NOT NULL,
    note text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    CONSTRAINT cash_movements_amount_check CHECK ((amount > 0)),
    CONSTRAINT cash_movements_note_check CHECK ((char_length(btrim(note)) >= 3)),
    CONSTRAINT cash_movements_type_category_check CHECK ((((type = 'IN'::text) AND (category = ANY (ARRAY['tambah_modal'::text, 'titipan'::text, 'lainnya_masuk'::text]))) OR ((type = 'OUT'::text) AND (category = ANY (ARRAY['operasional'::text, 'ongkir'::text, 'setor_owner'::text, 'belanja_stok'::text, 'lainnya_keluar'::text]))))),
    CONSTRAINT cash_movements_type_check CHECK ((type = ANY (ARRAY['IN'::text, 'OUT'::text]))),
    CONSTRAINT cash_movements_void_consistency CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (void_reason IS NOT NULL))))
);


--
-- Name: TABLE cash_movements; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.cash_movements IS 'Kas masuk (IN) / keluar (OUT) dari laci pada sebuah shift, di luar penjualan. Migration 040. Tidak bisa diubah/dihapus: koreksi lewat void_cash_movement (voided_at terisi).';


--
-- Name: COLUMN cash_movements.category; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.cash_movements.category IS 'IN: tambah_modal | titipan | lainnya_masuk. OUT: operasional | ongkir | setor_owner | belanja_stok | lainnya_keluar.';


--
-- Name: categories; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text,
    sort_order integer,
    is_active boolean DEFAULT true
);


--
-- Name: customer_point_logs; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.customer_point_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    type text NOT NULL,
    points_delta integer NOT NULL,
    balance_after integer NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    transaction_id uuid,
    CONSTRAINT customer_point_logs_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT customer_point_logs_type_check CHECK ((type = ANY (ARRAY['adjust'::text, 'redeem'::text, 'earn'::text, 'earn_return'::text, 'redeem_return'::text])))
);


--
-- Name: TABLE customer_point_logs; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.customer_point_logs IS 'Riwayat setiap perubahan saldo poin pelanggan (penyesuaian manual & pemakaian di Kasir). Hanya ditulis dari RPC SECURITY DEFINER. Migration 035.';


--
-- Name: customers; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    loyalty_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    address text,
    birth_date date,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    CONSTRAINT customers_loyalty_points_check CHECK ((loyalty_points >= 0))
);


--
-- Name: TABLE customers; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.customers IS 'Data pelanggan toko + saldo poin loyalitas. Dipakai layar Kasir untuk pencarian pelanggan opsional (fitur "Buka Kasir" flow baru). Tidak ada FK ke transactions pada tahap ini — lihat catatan header migration.';


--
-- Name: digital_payments; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.digital_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id text NOT NULL,
    cashier_id uuid NOT NULL,
    gross_amount bigint NOT NULL,
    snap_token text,
    status text DEFAULT 'pending'::text NOT NULL,
    midtrans_status text,
    payment_type text,
    raw_notification jsonb,
    transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    used_at timestamp with time zone,
    CONSTRAINT digital_payments_gross_amount_check CHECK ((gross_amount > 0)),
    CONSTRAINT digital_payments_order_id_check CHECK ((char_length(order_id) <= 50)),
    CONSTRAINT digital_payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: TABLE digital_payments; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.digital_payments IS 'Order pembayaran digital Midtrans (Snap). Ditulis server (service role); dipakai create_transaction_digital untuk memverifikasi pembayaran sebelum transaksi disimpan.';


--
-- Name: COLUMN digital_payments.transaction_id; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.digital_payments.transaction_id IS 'NULL selama order belum dipakai. Kalau status paid tapi transaction_id masih NULL berarti pelanggan sudah bayar tetapi transaksi POS belum tersimpan (perlu ditindaklanjuti).';


--
-- Name: gift_record_items; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.gift_record_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gift_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_sku text,
    product_unit text,
    qty integer NOT NULL,
    unit_cost bigint DEFAULT 0 NOT NULL,
    unit_price bigint DEFAULT 0 NOT NULL,
    movement_id uuid,
    CONSTRAINT gift_record_items_qty_check CHECK ((qty > 0)),
    CONSTRAINT gift_record_items_unit_cost_check CHECK ((unit_cost >= 0)),
    CONSTRAINT gift_record_items_unit_price_check CHECK ((unit_price >= 0))
);


--
-- Name: TABLE gift_record_items; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.gift_record_items IS 'Baris hadiah. Nama/SKU/satuan, harga modal, dan harga jual disalin (snapshot) saat dicatat.';


--
-- Name: gift_records; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.gift_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number bigint NOT NULL,
    given_at date NOT NULL,
    recipient_name text NOT NULL,
    recipient_category text DEFAULT 'lainnya'::text NOT NULL,
    occasion text,
    note text,
    status text DEFAULT 'completed'::text NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    total_qty integer DEFAULT 0 NOT NULL,
    total_cost bigint DEFAULT 0 NOT NULL,
    total_retail bigint DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_by uuid,
    voided_at timestamp with time zone,
    void_reason text,
    CONSTRAINT gift_records_recipient_category_check CHECK ((recipient_category = ANY (ARRAY['kyai'::text, 'tamu_pondok'::text, 'tamu_toko'::text, 'lainnya'::text]))),
    CONSTRAINT gift_records_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'voided'::text])))
);


--
-- Name: TABLE gift_records; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.gift_records IS 'Dokumen hadiah/oleh-oleh dari stok toko. total_cost = beban hadiah (qty x harga modal saat dicatat); total_retail = nilai jika dijual (info saja). status voided = dibatalkan, stok sudah dikembalikan.';


--
-- Name: COLUMN gift_records.recipient_category; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.gift_records.recipient_category IS 'kyai = Bapak Kiyai/pengasuh · tamu_pondok = tamu yang berkunjung ke pondok · tamu_toko = tamu/pembeli di toko · lainnya.';


--
-- Name: gift_records_number_seq; Type: SEQUENCE; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.gift_records ALTER COLUMN number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME e_pos.gift_records_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: held_orders; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.held_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cashier_id uuid NOT NULL,
    label text,
    items jsonb NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    subtotal bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE held_orders; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.held_orders IS 'Keranjang yang ditunda kasir (tombol "Tunda" di KasirModule.tsx, PRD §17 T-11). Bukan transaksi sah — row dihapus begitu dilanjutkan atau dibatalkan manual.';


--
-- Name: COLUMN held_orders.label; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.held_orders.label IS 'Catatan bebas dari kasir saat menunda, mis. nama pelanggan ("Budi - baju kuning") — opsional, membantu kasir lain kenali held order mana yang mana.';


--
-- Name: COLUMN held_orders.items; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.held_orders.items IS 'Array [{product_id, qty}] SAJA, tanpa harga/nama — harga & stok divalidasi ulang ke tabel products saat resume (lihat useHoldOrders.ts resumeHeldOrder()).';


--
-- Name: payments; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    method e_pos.payment_method NOT NULL,
    amount bigint NOT NULL,
    received_amount bigint,
    change_amount bigint,
    reference_no text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date,
    is_settled boolean DEFAULT false NOT NULL,
    settled_at timestamp with time zone,
    settled_by uuid
);


--
-- Name: COLUMN payments.due_date; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.payments.due_date IS 'Tanggal jatuh tempo, wajib diisi untuk method = TEMPO (divalidasi di RPC create_transaction). NULL untuk method lain.';


--
-- Name: COLUMN payments.is_settled; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.payments.is_settled IS 'Piutang TEMPO sudah dilunasi atau belum. Hanya bermakna untuk method = TEMPO — method lain selalu false secara default dan tidak boleh dipakai untuk logika apapun.';


--
-- Name: COLUMN payments.settled_at; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.payments.settled_at IS 'Waktu piutang ditandai lunas, diisi RPC settle_receivable. NULL selama is_settled = false.';


--
-- Name: COLUMN payments.settled_by; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.payments.settled_by IS 'Profil yang menandai lunas (bisa beda dari kasir yang membuat transaksi asli).';


--
-- Name: products; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    barcode text,
    name text NOT NULL,
    type e_pos.product_type NOT NULL,
    is_service boolean DEFAULT false,
    category_id uuid,
    unit text,
    sell_price bigint NOT NULL,
    cost_price bigint,
    stock integer DEFAULT 0,
    min_stock integer DEFAULT 0,
    photo_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    is_extra_charge boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN products.is_extra_charge; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.products.is_extra_charge IS 'true = tampil di modal Biaya Tambahan Kasir (kantong, paper bag, packaging, dst.) walau bukan produk Jasa, stok tetap dihitung. Produk Jasa selalu tampil di sana tanpa perlu penanda ini.';


--
-- Name: profiles; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    roles text[] DEFAULT ARRAY['kasir'::text] NOT NULL,
    permissions jsonb DEFAULT '{"kasir": {"view": true}}'::jsonb NOT NULL,
    CONSTRAINT profiles_permissions_object CHECK ((jsonb_typeof(permissions) = 'object'::text)),
    CONSTRAINT profiles_roles_not_empty CHECK ((cardinality(roles) >= 1)),
    CONSTRAINT profiles_roles_valid CHECK ((roles <@ ARRAY['super_admin'::text, 'admin'::text, 'supervisor'::text, 'kasir'::text, 'qc'::text]))
);


--
-- Name: COLUMN profiles.email; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.profiles.email IS 'Email user, diisi manual oleh admin (bukan sinkron otomatis dari auth.users) — dipakai tombol "Reset Password" di Pengaturan Admin (supabase.auth.resetPasswordForEmail). Bisa NULL untuk user lama yang belum diisi.';


--
-- Name: COLUMN profiles.roles; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.profiles.roles IS 'Label jabatan (boleh lebih dari satu): super_admin, admin, supervisor, kasir, qc. Hanya super_admin yang berarti khusus (semua akses). Migration 038, pengganti role_id/roles.';


--
-- Name: COLUMN profiles.permissions; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.profiles.permissions IS 'Izin per modul & aksi milik user ini: {"produk":{"view":true,"create":false,...},...}. Tidak tertulis = ditolak. Migration 038, pengganti role_permissions.';


--
-- Name: profiles_directory; Type: VIEW; Schema: e_pos; Owner: -
--

CREATE VIEW e_pos.profiles_directory WITH (security_invoker='true') AS
 SELECT id,
    full_name
   FROM e_pos.profiles
  WHERE (is_active = true);


--
-- Name: promo_media; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.promo_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    media_type text NOT NULL,
    file_url text NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    file_size bigint,
    duration_seconds integer DEFAULT 8 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    screen_id uuid,
    CONSTRAINT promo_media_duration_seconds_check CHECK (((duration_seconds >= 3) AND (duration_seconds <= 120))),
    CONSTRAINT promo_media_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])))
);


--
-- Name: TABLE promo_media; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.promo_media IS 'Media promosi (gambar/video) untuk layar TV toko, diputar berurutan oleh halaman /tv. File fisik di Storage bucket "promo-media", baris ini metadata + URL. Migration 026.';


--
-- Name: COLUMN promo_media.duration_seconds; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.promo_media.duration_seconds IS 'Lama tayang GAMBAR dalam detik (3-120). Diabaikan untuk video — video diputar sampai selesai.';


--
-- Name: COLUMN promo_media.sort_order; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.promo_media.sort_order IS 'Urutan tayang naik (kecil dulu). Ditulis ulang atomik oleh RPC reorder_promo_media.';


--
-- Name: COLUMN promo_media.screen_id; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.promo_media.screen_id IS 'Layar TV pemilik media ini (migration 027). NULL = media lama dari sebelum fitur multi-TV, tidak lagi tertayang di manapun sampai diberi screen_id manual.';


--
-- Name: promo_screens; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.promo_screens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    access_token text DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text)) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promo_screens_access_token_format CHECK ((access_token ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$'::text)),
    CONSTRAINT promo_screens_name_not_blank CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: TABLE promo_screens; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.promo_screens IS 'Satu baris = satu TV/layar promosi fisik. access_token adalah "kunci" URL publik /tv/[access_token] (migration 027) — pengganti login untuk perangkat TV.';


--
-- Name: COLUMN promo_screens.access_token; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.promo_screens.access_token IS 'String kunci URL publik /tv/[access_token]. Default token acak 64-hex, TAPI boleh diisi slug custom yang mudah dibaca (mis. "kasir-depan") saat membuat TV baru (migration 028). Format dibatasi CHECK constraint (huruf kecil/angka/tanda hubung, 3-64 char). Slug yang mudah ditebak berarti siapa pun yang menebaknya bisa melihat isi TV tsb (media promosi, bukan data sensitif).';


--
-- Name: settings; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: TABLE settings; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.settings IS 'Pengaturan toko & struk, key-value (PRD §17 T-01). value disimpan sebagai jsonb supaya boolean/number/string bisa ditampung tanpa kolom nullable terpisah per setting.';


--
-- Name: shift_sessions; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.shift_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cashier_id uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_cash bigint DEFAULT 0 NOT NULL,
    closed_at timestamp with time zone,
    expected_cash bigint,
    actual_cash bigint,
    difference bigint,
    status text DEFAULT 'OPEN'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    CONSTRAINT shift_sessions_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text])))
);


--
-- Name: TABLE shift_sessions; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.shift_sessions IS 'Shift kasir (PRD §17 T-04): buka dengan modal awal, tutup dengan hitung pecahan -> selisih kas otomatis. Satu kasir hanya boleh punya satu shift OPEN (lihat unique index di bawah).';


--
-- Name: COLUMN shift_sessions.opening_cash; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.shift_sessions.opening_cash IS 'Modal awal kas saat buka shift, default dari settings.shift_default_cash (diisi client saat buka, lihat useShifts.ts).';


--
-- Name: COLUMN shift_sessions.expected_cash; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.shift_sessions.expected_cash IS 'Kas yang seharusnya ada saat tutup (opening_cash + total tunai masuk selama shift), dihitung & dikunci oleh RPC close_shift.';


--
-- Name: COLUMN shift_sessions.actual_cash; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.shift_sessions.actual_cash IS 'Hasil hitung fisik pecahan uang oleh kasir saat tutup shift.';


--
-- Name: COLUMN shift_sessions.difference; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.shift_sessions.difference IS 'actual_cash - expected_cash. Negatif = kurang, positif = lebih.';


--
-- Name: COLUMN shift_sessions.notes; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.shift_sessions.notes IS 'Catatan sesi. Saat tutup: alasan selisih kas / catatan serah terima, diisi lewat close_shift(p_notes). Beberapa catatan digabung dengan " | ".';


--
-- Name: COLUMN shift_sessions.closed_by; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.shift_sessions.closed_by IS 'User yang menekan tutup sesi (pemilik sesi atau role lintas_kasir). Diisi oleh close_shift.';


--
-- Name: stock_movements; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    type text NOT NULL,
    qty_delta integer NOT NULL,
    reference_id uuid,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_manual_reason_check CHECK (((type <> ALL (ARRAY['opname'::text, 'adjustment'::text])) OR ((reason IS NOT NULL) AND (btrim(reason) <> ''::text)))),
    CONSTRAINT stock_movements_type_check CHECK ((type = ANY (ARRAY['sale'::text, 'return'::text, 'opname'::text, 'adjustment'::text, 'void'::text, 'stock_in'::text, 'initial'::text, 'gift'::text])))
);


--
-- Name: TABLE stock_movements; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.stock_movements IS 'Audit trail mutasi stok (PRD §6, §17 T-05). Satu-satunya cara sah mengubah products.stock adalah lewat RPC yang sekaligus menulis baris di sini: create_transaction (sale), return_transaction (return), void_transaction (void), adjust_stock (opname/adjustment).';


--
-- Name: COLUMN stock_movements.type; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.stock_movements.type IS 'sale = penjualan · return = retur masuk · void = pembatalan transaksi · opname = hasil hitung fisik · adjustment = penyesuaian manual · stock_in = barang masuk (penerimaan) · initial = stok awal produk baru · gift = hadiah/oleh-oleh keluar (negatif) atau pembatalannya (positif).';


--
-- Name: COLUMN stock_movements.qty_delta; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.stock_movements.qty_delta IS 'Selisih stok: NEGATIF = stok berkurang, POSITIF = stok bertambah. Stok baru = stok lama + qty_delta.';


--
-- Name: COLUMN stock_movements.reference_id; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.stock_movements.reference_id IS 'Transaksi sumber untuk type sale/return/void (transactions.id). NULL untuk mutasi manual.';


--
-- Name: COLUMN stock_movements.reason; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.stock_movements.reason IS 'Wajib diisi untuk type opname/adjustment (ditegakkan check constraint + RPC adjust_stock). Boleh NULL untuk mutasi otomatis.';


--
-- Name: stock_ledger; Type: VIEW; Schema: e_pos; Owner: -
--

CREATE VIEW e_pos.stock_ledger WITH (security_invoker='true') AS
 SELECT m.id,
    m.product_id,
    m.type,
    m.qty_delta,
    m.reference_id,
    m.reason,
    m.created_by,
    m.created_at,
    p.name AS product_name,
    p.sku AS product_sku,
    p.unit AS product_unit,
        CASE
            WHEN ((m.product_id IS NULL) OR (p.id IS NULL)) THEN NULL::integer
            ELSE ((COALESCE(p.stock, 0) - COALESCE(sum(m.qty_delta) OVER (PARTITION BY m.product_id ORDER BY m.created_at DESC, m.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), (0)::bigint)))::integer
        END AS stock_after
   FROM (e_pos.stock_movements m
     LEFT JOIN e_pos.products p ON ((p.id = m.product_id)));


--
-- Name: VIEW stock_ledger; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON VIEW e_pos.stock_ledger IS 'Kartu stok: stock_movements + nama/SKU/satuan produk + stock_after (saldo sesudah mutasi, dihitung mundur dari products.stock). security_invoker = true, jadi RLS stock_movements & products tetap berlaku untuk pemanggil.';


--
-- Name: stock_opname_items; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.stock_opname_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_sku text,
    product_barcode text,
    product_unit text,
    cost_price bigint,
    system_qty integer NOT NULL,
    counted_qty integer,
    note text,
    counted_by uuid,
    counted_at timestamp with time zone,
    applied_delta integer,
    movement_id uuid,
    CONSTRAINT stock_opname_items_counted_qty_check CHECK (((counted_qty IS NULL) OR (counted_qty >= 0)))
);


--
-- Name: TABLE stock_opname_items; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.stock_opname_items IS 'Produk dalam sesi opname. system_qty = stok sistem pada saat hitungan terakhir disimpan (atau saat sesi dimulai kalau belum dihitung); counted_qty NULL = belum dihitung. Nama/SKU/barcode/satuan/harga modal disalin (snapshot) saat sesi dimulai.';


--
-- Name: COLUMN stock_opname_items.applied_delta; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.stock_opname_items.applied_delta IS 'Selisih yang benar-benar diterapkan ke stok saat sesi diselesaikan (counted_qty - system_qty). NULL kalau belum diterapkan / dilewati.';


--
-- Name: stock_opname_sessions; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.stock_opname_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number bigint NOT NULL,
    name text NOT NULL,
    category_id uuid,
    category_name text,
    status text DEFAULT 'draft'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_by uuid,
    finalized_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    CONSTRAINT stock_opname_sessions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE stock_opname_sessions; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.stock_opname_sessions IS 'Sesi opname stok (Fase 2). status: draft = sedang menghitung, completed = selisih sudah diterapkan ke stok, cancelled = dibatalkan (stok tidak berubah).';


--
-- Name: stock_opname_session_stats; Type: VIEW; Schema: e_pos; Owner: -
--

CREATE VIEW e_pos.stock_opname_session_stats WITH (security_invoker='true') AS
 SELECT s.id,
    s.number,
    s.name,
    s.category_id,
    s.category_name,
    s.status,
    s.note,
    s.created_by,
    s.created_at,
    s.finalized_by,
    s.finalized_at,
    s.cancelled_by,
    s.cancelled_at,
    s.cancel_reason,
    COALESCE(c.item_count, (0)::bigint) AS item_count,
    COALESCE(c.counted_count, (0)::bigint) AS counted_count,
    COALESCE(c.diff_count, (0)::bigint) AS diff_count,
    COALESCE(c.diff_qty, (0)::bigint) AS diff_qty,
    (COALESCE(c.diff_value, (0)::numeric))::bigint AS diff_value
   FROM (e_pos.stock_opname_sessions s
     LEFT JOIN LATERAL ( SELECT count(*) AS item_count,
            count(i.counted_qty) AS counted_count,
            count(*) FILTER (WHERE ((i.counted_qty IS NOT NULL) AND (i.counted_qty <> i.system_qty))) AS diff_count,
            sum((i.counted_qty - i.system_qty)) FILTER (WHERE (i.counted_qty IS NOT NULL)) AS diff_qty,
            sum((((i.counted_qty - i.system_qty))::bigint * COALESCE(i.cost_price, (0)::bigint))) FILTER (WHERE (i.counted_qty IS NOT NULL)) AS diff_value
           FROM e_pos.stock_opname_items i
          WHERE (i.session_id = s.id)) c ON (true));


--
-- Name: VIEW stock_opname_session_stats; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON VIEW e_pos.stock_opname_session_stats IS 'Sesi opname + progres (counted_count/item_count) dan total selisih (unit & nilai rupiah berdasarkan harga modal). security_invoker = true.';


--
-- Name: stock_opname_sessions_number_seq; Type: SEQUENCE; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_opname_sessions ALTER COLUMN number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME e_pos.stock_opname_sessions_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: stock_receipt_items; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.stock_receipt_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_sku text,
    product_unit text,
    qty integer NOT NULL,
    unit_cost bigint,
    movement_id uuid,
    CONSTRAINT stock_receipt_items_qty_check CHECK ((qty > 0)),
    CONSTRAINT stock_receipt_items_unit_cost_check CHECK (((unit_cost IS NULL) OR (unit_cost >= 0)))
);


--
-- Name: TABLE stock_receipt_items; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.stock_receipt_items IS 'Baris barang masuk. Nama/SKU/satuan disalin (snapshot) saat dicatat.';


--
-- Name: stock_receipts; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.stock_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number bigint NOT NULL,
    received_at date NOT NULL,
    supplier text,
    reference_no text,
    note text,
    status text DEFAULT 'completed'::text NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    total_qty integer DEFAULT 0 NOT NULL,
    total_cost bigint DEFAULT 0 NOT NULL,
    cost_updated boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_by uuid,
    voided_at timestamp with time zone,
    void_reason text,
    CONSTRAINT stock_receipts_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'voided'::text])))
);


--
-- Name: TABLE stock_receipts; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON TABLE e_pos.stock_receipts IS 'Dokumen barang masuk (penerimaan). total_cost = jumlah qty x harga beli baris yang diisi harga belinya. status voided = sudah dibatalkan (stok dikurangi kembali).';


--
-- Name: stock_receipts_number_seq; Type: SEQUENCE; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_receipts ALTER COLUMN number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME e_pos.stock_receipts_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: transaction_items; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.transaction_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    product_id uuid,
    sku text,
    product_name text NOT NULL,
    qty integer NOT NULL,
    returned_qty integer DEFAULT 0 NOT NULL,
    unit text,
    unit_price bigint NOT NULL,
    discount bigint DEFAULT 0 NOT NULL,
    subtotal bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: e_pos; Owner: -
--

CREATE TABLE e_pos.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_no text NOT NULL,
    status e_pos.transaction_status NOT NULL,
    subtotal bigint NOT NULL,
    discount bigint DEFAULT 0 NOT NULL,
    tax bigint DEFAULT 0 NOT NULL,
    total bigint NOT NULL,
    cashier_id uuid,
    shift_id uuid,
    customer_name text,
    customer_phone text,
    notes text,
    void_reason text,
    related_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    customer_id uuid,
    points_redeemed integer DEFAULT 0 NOT NULL,
    points_earned integer DEFAULT 0 NOT NULL,
    CONSTRAINT transactions_points_earned_check CHECK ((points_earned >= 0)),
    CONSTRAINT transactions_points_redeemed_check CHECK ((points_redeemed >= 0))
);


--
-- Name: COLUMN transactions.cashier_id; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.transactions.cashier_id IS 'Diisi setelah sistem Auth + role (profiles) dibangun. NULL untuk transaksi lama & sebelum Auth aktif.';


--
-- Name: COLUMN transactions.shift_id; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.transactions.shift_id IS 'Diisi setelah fitur Kas & Shift dibangun. NULL untuk transaksi lama & sebelum shift aktif.';


--
-- Name: COLUMN transactions.void_reason; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON COLUMN e_pos.transactions.void_reason IS 'Alasan void, diisi saat transaksi di-void. Pertimbangkan juga catat di activity_logs untuk audit trail.';


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: cash_movements cash_movements_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: customer_point_logs customer_point_logs_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.customer_point_logs
    ADD CONSTRAINT customer_point_logs_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: digital_payments digital_payments_order_id_key; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.digital_payments
    ADD CONSTRAINT digital_payments_order_id_key UNIQUE (order_id);


--
-- Name: digital_payments digital_payments_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.digital_payments
    ADD CONSTRAINT digital_payments_pkey PRIMARY KEY (id);


--
-- Name: gift_record_items gift_record_items_gift_id_product_id_key; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_record_items
    ADD CONSTRAINT gift_record_items_gift_id_product_id_key UNIQUE (gift_id, product_id);


--
-- Name: gift_record_items gift_record_items_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_record_items
    ADD CONSTRAINT gift_record_items_pkey PRIMARY KEY (id);


--
-- Name: gift_records gift_records_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_records
    ADD CONSTRAINT gift_records_pkey PRIMARY KEY (id);


--
-- Name: held_orders held_orders_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.held_orders
    ADD CONSTRAINT held_orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: promo_media promo_media_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.promo_media
    ADD CONSTRAINT promo_media_pkey PRIMARY KEY (id);


--
-- Name: promo_screens promo_screens_access_token_key; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.promo_screens
    ADD CONSTRAINT promo_screens_access_token_key UNIQUE (access_token);


--
-- Name: promo_screens promo_screens_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.promo_screens
    ADD CONSTRAINT promo_screens_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: shift_sessions shift_sessions_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.shift_sessions
    ADD CONSTRAINT shift_sessions_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: stock_opname_items stock_opname_items_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_items
    ADD CONSTRAINT stock_opname_items_pkey PRIMARY KEY (id);


--
-- Name: stock_opname_items stock_opname_items_session_id_product_id_key; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_items
    ADD CONSTRAINT stock_opname_items_session_id_product_id_key UNIQUE (session_id, product_id);


--
-- Name: stock_opname_sessions stock_opname_sessions_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_sessions
    ADD CONSTRAINT stock_opname_sessions_pkey PRIMARY KEY (id);


--
-- Name: stock_receipt_items stock_receipt_items_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipt_items
    ADD CONSTRAINT stock_receipt_items_pkey PRIMARY KEY (id);


--
-- Name: stock_receipt_items stock_receipt_items_receipt_id_product_id_key; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipt_items
    ADD CONSTRAINT stock_receipt_items_receipt_id_product_id_key UNIQUE (receipt_id, product_id);


--
-- Name: stock_receipts stock_receipts_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipts
    ADD CONSTRAINT stock_receipts_pkey PRIMARY KEY (id);


--
-- Name: transaction_items transaction_items_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transaction_items
    ADD CONSTRAINT transaction_items_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: activity_logs_created_at_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX activity_logs_created_at_idx ON e_pos.activity_logs USING btree (created_at DESC);


--
-- Name: activity_logs_entity_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX activity_logs_entity_idx ON e_pos.activity_logs USING btree (entity, entity_id);


--
-- Name: cash_movements_shift_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX cash_movements_shift_idx ON e_pos.cash_movements USING btree (shift_id, created_at);


--
-- Name: customer_point_logs_customer_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX customer_point_logs_customer_idx ON e_pos.customer_point_logs USING btree (customer_id, created_at DESC);


--
-- Name: customers_active_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX customers_active_idx ON e_pos.customers USING btree (is_active);


--
-- Name: customers_name_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX customers_name_idx ON e_pos.customers USING btree (lower(name));


--
-- Name: customers_phone_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX customers_phone_idx ON e_pos.customers USING btree (phone);


--
-- Name: customers_phone_unique_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE UNIQUE INDEX customers_phone_unique_idx ON e_pos.customers USING btree (e_pos.normalize_phone(phone)) WHERE ((phone IS NOT NULL) AND (e_pos.normalize_phone(phone) IS NOT NULL));


--
-- Name: digital_payments_cashier_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX digital_payments_cashier_idx ON e_pos.digital_payments USING btree (cashier_id, created_at DESC);


--
-- Name: digital_payments_status_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX digital_payments_status_idx ON e_pos.digital_payments USING btree (status) WHERE (transaction_id IS NULL);


--
-- Name: gift_record_items_gift_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX gift_record_items_gift_idx ON e_pos.gift_record_items USING btree (gift_id);


--
-- Name: gift_record_items_product_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX gift_record_items_product_idx ON e_pos.gift_record_items USING btree (product_id);


--
-- Name: gift_records_given_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX gift_records_given_idx ON e_pos.gift_records USING btree (given_at DESC, created_at DESC);


--
-- Name: gift_records_number_key; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE UNIQUE INDEX gift_records_number_key ON e_pos.gift_records USING btree (number);


--
-- Name: held_orders_cashier_id_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX held_orders_cashier_id_idx ON e_pos.held_orders USING btree (cashier_id);


--
-- Name: held_orders_created_at_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX held_orders_created_at_idx ON e_pos.held_orders USING btree (created_at DESC);


--
-- Name: payments_tempo_unsettled_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX payments_tempo_unsettled_idx ON e_pos.payments USING btree (due_date) WHERE ((method = 'TEMPO'::e_pos.payment_method) AND (is_settled = false));


--
-- Name: promo_media_active_order_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX promo_media_active_order_idx ON e_pos.promo_media USING btree (is_active, sort_order, created_at);


--
-- Name: promo_media_screen_id_sort_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX promo_media_screen_id_sort_idx ON e_pos.promo_media USING btree (screen_id, sort_order);


--
-- Name: shift_sessions_cashier_id_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX shift_sessions_cashier_id_idx ON e_pos.shift_sessions USING btree (cashier_id);


--
-- Name: shift_sessions_one_open_per_cashier; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE UNIQUE INDEX shift_sessions_one_open_per_cashier ON e_pos.shift_sessions USING btree (cashier_id) WHERE (status = 'OPEN'::text);


--
-- Name: stock_movements_created_at_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_movements_created_at_idx ON e_pos.stock_movements USING btree (created_at DESC);


--
-- Name: stock_movements_created_by_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_movements_created_by_idx ON e_pos.stock_movements USING btree (created_by);


--
-- Name: stock_movements_product_created_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_movements_product_created_idx ON e_pos.stock_movements USING btree (product_id, created_at DESC);


--
-- Name: stock_movements_reference_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_movements_reference_idx ON e_pos.stock_movements USING btree (reference_id);


--
-- Name: stock_opname_items_product_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_opname_items_product_idx ON e_pos.stock_opname_items USING btree (product_id);


--
-- Name: stock_opname_items_session_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_opname_items_session_idx ON e_pos.stock_opname_items USING btree (session_id);


--
-- Name: stock_opname_sessions_number_key; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE UNIQUE INDEX stock_opname_sessions_number_key ON e_pos.stock_opname_sessions USING btree (number);


--
-- Name: stock_opname_sessions_status_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_opname_sessions_status_idx ON e_pos.stock_opname_sessions USING btree (status, created_at DESC);


--
-- Name: stock_receipt_items_product_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_receipt_items_product_idx ON e_pos.stock_receipt_items USING btree (product_id);


--
-- Name: stock_receipt_items_receipt_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_receipt_items_receipt_idx ON e_pos.stock_receipt_items USING btree (receipt_id);


--
-- Name: stock_receipts_number_key; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE UNIQUE INDEX stock_receipts_number_key ON e_pos.stock_receipts USING btree (number);


--
-- Name: stock_receipts_received_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX stock_receipts_received_idx ON e_pos.stock_receipts USING btree (received_at DESC, created_at DESC);


--
-- Name: transactions_customer_id_idx; Type: INDEX; Schema: e_pos; Owner: -
--

CREATE INDEX transactions_customer_id_idx ON e_pos.transactions USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: products products_log_initial_stock; Type: TRIGGER; Schema: e_pos; Owner: -
--

CREATE TRIGGER products_log_initial_stock AFTER INSERT ON e_pos.products FOR EACH ROW EXECUTE FUNCTION e_pos.log_initial_stock();


--
-- Name: profiles profiles_enforce_role_change; Type: TRIGGER; Schema: e_pos; Owner: -
--

CREATE TRIGGER profiles_enforce_role_change BEFORE UPDATE ON e_pos.profiles FOR EACH ROW EXECUTE FUNCTION e_pos.enforce_profiles_role_change();


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES e_pos.profiles(id);


--
-- Name: cash_movements cash_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.cash_movements
    ADD CONSTRAINT cash_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: cash_movements cash_movements_shift_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.cash_movements
    ADD CONSTRAINT cash_movements_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES e_pos.shift_sessions(id) ON DELETE RESTRICT;


--
-- Name: cash_movements cash_movements_voided_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.cash_movements
    ADD CONSTRAINT cash_movements_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: customer_point_logs customer_point_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.customer_point_logs
    ADD CONSTRAINT customer_point_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: customer_point_logs customer_point_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.customer_point_logs
    ADD CONSTRAINT customer_point_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES e_pos.customers(id) ON DELETE CASCADE;


--
-- Name: customer_point_logs customer_point_logs_transaction_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.customer_point_logs
    ADD CONSTRAINT customer_point_logs_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES e_pos.transactions(id) ON DELETE SET NULL;


--
-- Name: customers customers_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.customers
    ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: digital_payments digital_payments_cashier_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.digital_payments
    ADD CONSTRAINT digital_payments_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES e_pos.profiles(id);


--
-- Name: digital_payments digital_payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.digital_payments
    ADD CONSTRAINT digital_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES e_pos.transactions(id);


--
-- Name: gift_record_items gift_record_items_gift_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_record_items
    ADD CONSTRAINT gift_record_items_gift_id_fkey FOREIGN KEY (gift_id) REFERENCES e_pos.gift_records(id) ON DELETE CASCADE;


--
-- Name: gift_record_items gift_record_items_product_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_record_items
    ADD CONSTRAINT gift_record_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES e_pos.products(id) ON DELETE SET NULL;


--
-- Name: gift_records gift_records_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_records
    ADD CONSTRAINT gift_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: gift_records gift_records_voided_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.gift_records
    ADD CONSTRAINT gift_records_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: held_orders held_orders_cashier_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.held_orders
    ADD CONSTRAINT held_orders_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES e_pos.profiles(id) ON DELETE CASCADE;


--
-- Name: payments payments_settled_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.payments
    ADD CONSTRAINT payments_settled_by_fkey FOREIGN KEY (settled_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: payments payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.payments
    ADD CONSTRAINT payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES e_pos.transactions(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES e_pos.categories(id);


--
-- Name: promo_media promo_media_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.promo_media
    ADD CONSTRAINT promo_media_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: promo_media promo_media_screen_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.promo_media
    ADD CONSTRAINT promo_media_screen_id_fkey FOREIGN KEY (screen_id) REFERENCES e_pos.promo_screens(id) ON DELETE CASCADE;


--
-- Name: promo_screens promo_screens_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.promo_screens
    ADD CONSTRAINT promo_screens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: settings settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.settings
    ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shift_sessions shift_sessions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.shift_sessions
    ADD CONSTRAINT shift_sessions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES e_pos.profiles(id) ON DELETE CASCADE;


--
-- Name: shift_sessions shift_sessions_closed_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.shift_sessions
    ADD CONSTRAINT shift_sessions_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES e_pos.products(id);


--
-- Name: stock_opname_items stock_opname_items_counted_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_items
    ADD CONSTRAINT stock_opname_items_counted_by_fkey FOREIGN KEY (counted_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_opname_items stock_opname_items_product_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_items
    ADD CONSTRAINT stock_opname_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES e_pos.products(id) ON DELETE SET NULL;


--
-- Name: stock_opname_items stock_opname_items_session_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_items
    ADD CONSTRAINT stock_opname_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES e_pos.stock_opname_sessions(id) ON DELETE CASCADE;


--
-- Name: stock_opname_sessions stock_opname_sessions_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_sessions
    ADD CONSTRAINT stock_opname_sessions_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_opname_sessions stock_opname_sessions_category_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_sessions
    ADD CONSTRAINT stock_opname_sessions_category_id_fkey FOREIGN KEY (category_id) REFERENCES e_pos.categories(id) ON DELETE SET NULL;


--
-- Name: stock_opname_sessions stock_opname_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_sessions
    ADD CONSTRAINT stock_opname_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_opname_sessions stock_opname_sessions_finalized_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_opname_sessions
    ADD CONSTRAINT stock_opname_sessions_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_receipt_items stock_receipt_items_product_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipt_items
    ADD CONSTRAINT stock_receipt_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES e_pos.products(id) ON DELETE SET NULL;


--
-- Name: stock_receipt_items stock_receipt_items_receipt_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipt_items
    ADD CONSTRAINT stock_receipt_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES e_pos.stock_receipts(id) ON DELETE CASCADE;


--
-- Name: stock_receipts stock_receipts_created_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipts
    ADD CONSTRAINT stock_receipts_created_by_fkey FOREIGN KEY (created_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_receipts stock_receipts_voided_by_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.stock_receipts
    ADD CONSTRAINT stock_receipts_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES e_pos.profiles(id) ON DELETE SET NULL;


--
-- Name: transaction_items transaction_items_product_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transaction_items
    ADD CONSTRAINT transaction_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES e_pos.products(id);


--
-- Name: transaction_items transaction_items_transaction_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transaction_items
    ADD CONSTRAINT transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES e_pos.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transactions
    ADD CONSTRAINT transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES e_pos.profiles(id);


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transactions
    ADD CONSTRAINT transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES e_pos.customers(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_shift_id_fkey; Type: FK CONSTRAINT; Schema: e_pos; Owner: -
--

ALTER TABLE ONLY e_pos.transactions
    ADD CONSTRAINT transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES e_pos.shift_sessions(id) ON DELETE SET NULL;


--
-- Name: activity_logs; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_logs activity_logs_select_log_aktivitas; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY activity_logs_select_log_aktivitas ON e_pos.activity_logs FOR SELECT USING (e_pos.has_permission_action('log_aktivitas'::text, 'view'::text));


--
-- Name: cash_movements; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.cash_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_movements cash_movements_select_own_or_lintas_kasir; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY cash_movements_select_own_or_lintas_kasir ON e_pos.cash_movements FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM e_pos.shift_sessions s
  WHERE ((s.id = cash_movements.shift_id) AND ((s.cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir())))));


--
-- Name: categories; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_delete_produk; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY categories_delete_produk ON e_pos.categories FOR DELETE TO authenticated USING (e_pos.has_permission_action('produk'::text, 'delete'::text));


--
-- Name: categories categories_insert_produk; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY categories_insert_produk ON e_pos.categories FOR INSERT TO authenticated WITH CHECK (e_pos.has_permission_action('produk'::text, 'create'::text));


--
-- Name: categories categories_select_active_users; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY categories_select_active_users ON e_pos.categories FOR SELECT TO authenticated USING ((e_pos.current_role_id() IS NOT NULL));


--
-- Name: categories categories_update_produk; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY categories_update_produk ON e_pos.categories FOR UPDATE TO authenticated USING (e_pos.has_permission_action('produk'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('produk'::text, 'edit'::text));


--
-- Name: customer_point_logs; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.customer_point_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_point_logs customer_point_logs_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY customer_point_logs_select ON e_pos.customer_point_logs FOR SELECT TO authenticated USING (e_pos.has_permission('pelanggan'::text));


--
-- Name: customers; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_insert_active_users; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY customers_insert_active_users ON e_pos.customers FOR INSERT TO authenticated WITH CHECK ((e_pos.current_role_id() IS NOT NULL));


--
-- Name: customers customers_select_active_users; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY customers_select_active_users ON e_pos.customers FOR SELECT TO authenticated USING ((e_pos.current_role_id() IS NOT NULL));


--
-- Name: customers customers_update_permission; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY customers_update_permission ON e_pos.customers FOR UPDATE TO authenticated USING (e_pos.has_permission_action('pelanggan'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('pelanggan'::text, 'edit'::text));


--
-- Name: digital_payments; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.digital_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: digital_payments digital_payments_select_own_or_supervisor; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY digital_payments_select_own_or_supervisor ON e_pos.digital_payments FOR SELECT USING (((cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir()));


--
-- Name: gift_record_items; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.gift_record_items ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_record_items gift_record_items_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY gift_record_items_select ON e_pos.gift_record_items FOR SELECT USING (e_pos.has_permission_action('hadiah'::text, 'view'::text));


--
-- Name: gift_records; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.gift_records ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_records gift_records_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY gift_records_select ON e_pos.gift_records FOR SELECT USING (e_pos.has_permission_action('hadiah'::text, 'view'::text));


--
-- Name: held_orders; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.held_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: held_orders held_orders_delete_own_or_lintas_kasir; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY held_orders_delete_own_or_lintas_kasir ON e_pos.held_orders FOR DELETE USING (((cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir()));


--
-- Name: held_orders held_orders_insert_own; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY held_orders_insert_own ON e_pos.held_orders FOR INSERT WITH CHECK (((cashier_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM e_pos.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true))))));


--
-- Name: held_orders held_orders_select_own_or_lintas_kasir; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY held_orders_select_own_or_lintas_kasir ON e_pos.held_orders FOR SELECT USING (((cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir()));


--
-- Name: payments; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_select_authenticated; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY payments_select_authenticated ON e_pos.payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM e_pos.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: products; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_insert_produk; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY products_insert_produk ON e_pos.products FOR INSERT TO authenticated WITH CHECK (e_pos.has_permission_action('produk'::text, 'create'::text));


--
-- Name: products products_select_active_users; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY products_select_active_users ON e_pos.products FOR SELECT TO authenticated USING ((e_pos.current_role_id() IS NOT NULL));


--
-- Name: products products_update_produk; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY products_update_produk ON e_pos.products FOR UPDATE TO authenticated USING (e_pos.has_permission_action('produk'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('produk'::text, 'edit'::text));


--
-- Name: profiles; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY profiles_select_own ON e_pos.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: profiles profiles_select_pengaturan_admin; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY profiles_select_pengaturan_admin ON e_pos.profiles FOR SELECT TO authenticated USING (e_pos.has_permission_action('pengaturan_admin'::text, 'view'::text));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY profiles_update_own ON e_pos.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--
-- Name: profiles profiles_update_pengaturan_admin; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY profiles_update_pengaturan_admin ON e_pos.profiles FOR UPDATE TO authenticated USING (e_pos.has_permission_action('pengaturan_admin'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('pengaturan_admin'::text, 'edit'::text));


--
-- Name: POLICY profiles_update_pengaturan_admin ON profiles; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON POLICY profiles_update_pengaturan_admin ON e_pos.profiles IS 'Boleh UPDATE baris user lain kalau punya izin pengaturan_admin.edit. Batasan siapa boleh mengubah apa ditegakkan trigger enforce_profiles_role_change (migration 038), bukan lagi perbandingan level.';


--
-- Name: promo_media; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.promo_media ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_media promo_media_delete_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_media_delete_promo ON e_pos.promo_media FOR DELETE TO authenticated USING (e_pos.has_permission_action('promo'::text, 'delete'::text));


--
-- Name: promo_media promo_media_insert_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_media_insert_promo ON e_pos.promo_media FOR INSERT TO authenticated WITH CHECK (e_pos.has_permission_action('promo'::text, 'create'::text));


--
-- Name: promo_media promo_media_select_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_media_select_promo ON e_pos.promo_media FOR SELECT TO authenticated USING (e_pos.has_permission_action('promo'::text, 'view'::text));


--
-- Name: promo_media promo_media_update_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_media_update_promo ON e_pos.promo_media FOR UPDATE TO authenticated USING (e_pos.has_permission_action('promo'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('promo'::text, 'edit'::text));


--
-- Name: promo_screens; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.promo_screens ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_screens promo_screens_delete_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_screens_delete_promo ON e_pos.promo_screens FOR DELETE TO authenticated USING (e_pos.has_permission_action('promo'::text, 'delete'::text));


--
-- Name: promo_screens promo_screens_insert_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_screens_insert_promo ON e_pos.promo_screens FOR INSERT TO authenticated WITH CHECK (e_pos.has_permission_action('promo'::text, 'create'::text));


--
-- Name: promo_screens promo_screens_select_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_screens_select_promo ON e_pos.promo_screens FOR SELECT TO authenticated USING (e_pos.has_permission_action('promo'::text, 'view'::text));


--
-- Name: promo_screens promo_screens_update_promo; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY promo_screens_update_promo ON e_pos.promo_screens FOR UPDATE TO authenticated USING (e_pos.has_permission_action('promo'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('promo'::text, 'edit'::text));


--
-- Name: settings; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: settings settings_delete_super_admin_only; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY settings_delete_super_admin_only ON e_pos.settings FOR DELETE USING (e_pos.is_super_admin());


--
-- Name: settings settings_insert_pengaturan_toko; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY settings_insert_pengaturan_toko ON e_pos.settings FOR INSERT WITH CHECK (e_pos.has_permission_action('pengaturan_toko'::text, 'edit'::text));


--
-- Name: settings settings_select_active_users; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY settings_select_active_users ON e_pos.settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM e_pos.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: settings settings_update_pengaturan_toko; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY settings_update_pengaturan_toko ON e_pos.settings FOR UPDATE USING (e_pos.has_permission_action('pengaturan_toko'::text, 'edit'::text)) WITH CHECK (e_pos.has_permission_action('pengaturan_toko'::text, 'edit'::text));


--
-- Name: shift_sessions; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.shift_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_sessions shift_sessions_insert_own; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY shift_sessions_insert_own ON e_pos.shift_sessions FOR INSERT WITH CHECK (((cashier_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM e_pos.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true))))));


--
-- Name: shift_sessions shift_sessions_select_own_or_lintas_kasir; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY shift_sessions_select_own_or_lintas_kasir ON e_pos.shift_sessions FOR SELECT USING (((cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir()));


--
-- Name: shift_sessions shift_sessions_update_own_or_lintas_kasir; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY shift_sessions_update_own_or_lintas_kasir ON e_pos.shift_sessions FOR UPDATE USING (((cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir())) WITH CHECK (((cashier_id = auth.uid()) OR e_pos.current_role_lintas_kasir()));


--
-- Name: stock_movements; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements stock_movements_select_stok; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY stock_movements_select_stok ON e_pos.stock_movements FOR SELECT USING (e_pos.has_permission_action('stok'::text, 'view'::text));


--
-- Name: stock_opname_items; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_opname_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_opname_items stock_opname_items_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY stock_opname_items_select ON e_pos.stock_opname_items FOR SELECT USING (e_pos.has_permission_action('stok'::text, 'view'::text));


--
-- Name: stock_opname_sessions; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_opname_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_opname_sessions stock_opname_sessions_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY stock_opname_sessions_select ON e_pos.stock_opname_sessions FOR SELECT USING (e_pos.has_permission_action('stok'::text, 'view'::text));


--
-- Name: stock_receipt_items; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_receipt_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_receipt_items stock_receipt_items_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY stock_receipt_items_select ON e_pos.stock_receipt_items FOR SELECT USING (e_pos.has_permission_action('stok'::text, 'view'::text));


--
-- Name: stock_receipts; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.stock_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_receipts stock_receipts_select; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY stock_receipts_select ON e_pos.stock_receipts FOR SELECT USING (e_pos.has_permission_action('stok'::text, 'view'::text));


--
-- Name: transaction_items; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.transaction_items ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_items transaction_items_select_authenticated; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY transaction_items_select_authenticated ON e_pos.transaction_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM e_pos.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: e_pos; Owner: -
--

ALTER TABLE e_pos.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_select_authenticated; Type: POLICY; Schema: e_pos; Owner: -
--

CREATE POLICY transactions_select_authenticated ON e_pos.transactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM e_pos.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_active = true)))));


--
-- Name: POLICY transactions_select_authenticated ON transactions; Type: COMMENT; Schema: e_pos; Owner: -
--

COMMENT ON POLICY transactions_select_authenticated ON e_pos.transactions IS 'Semua user login (role apa saja, asal is_active) boleh lihat semua transaksi — sengaja tidak dibatasi per-kasir, lihat catatan desain di header migration 011. Anon/publik otomatis ditolak karena auth.uid() bernilai NULL untuk mereka.';


--
-- PostgreSQL database dump complete
--


-- =====================================================================
-- BAGIAN B -- HAK AKSES SCHEMA e_pos (WAJIB untuk schema kustom)
-- Di `public`, Supabase memberi hak ini otomatis. Di schema kustom harus
-- manual, kalau tidak PostgREST menolak: "permission denied for schema".
-- Akses data tetap dijaga RLS (semua tabel RLS aktif).
-- =====================================================================
GRANT USAGE ON SCHEMA e_pos TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA e_pos TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA e_pos TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA e_pos TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA e_pos GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA e_pos GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA e_pos GRANT ALL ON FUNCTIONS TO authenticated, service_role;

-- Function untuk anon (tanpa login): hanya 2 RPC publik.
--   get_transaction_by_receipt -> halaman /cek-struk
--   get_screen_playlist        -> halaman /tv/[token]
-- (Terverifikasi di database lama: anon hanya punya EXECUTE pada 2 function ini.)
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA e_pos FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e_pos.get_transaction_by_receipt(text, date) TO anon;
GRANT EXECUTE ON FUNCTION e_pos.get_screen_playlist(text)               TO anon;


-- =====================================================================
-- BAGIAN C -- DATA AWAL (tidak ikut pg_dump --schema-only)
-- =====================================================================
-- C1. settings: disalin dari database produksi lama (16 key, nilai asli toko).
INSERT INTO e_pos.settings (key, value, description) VALUES
  ('alamat', '"Jl. Olahraga, Mandungan, Widang, Tuban, Jawa Timur"'::jsonb, 'Alamat toko, tampil di footer struk/nota.'),
  ('digital_payment_enabled', 'false'::jsonb, 'Aktifkan metode pembayaran Digital (Midtrans) di kasir. Kalau false, kasir hanya menampilkan Tunai & Piutang.'),
  ('footer_struk', '"Barang yang sudah dibeli tidak dapat dikembalikan"'::jsonb, 'Teks footer struk/nota.'),
  ('nama_toko', '"Langitan.co"'::jsonb, 'Nama toko, tampil di header struk/nota.'),
  ('paper_nota', '"A6"'::jsonb, 'Ukuran kertas nota: "A6" atau "A5".'),
  ('paper_thermal', '"80mm"'::jsonb, 'Ukuran kertas thermal: "58mm" atau "80mm".'),
  ('ppn_enabled', 'false'::jsonb, 'Aktifkan baris PPN di transaksi (PaymentModal) & struk. Default off sesuai PRD §4.2.'),
  ('ppn_rate', '11'::jsonb, 'Persentase PPN, dipakai kalau ppn_enabled = true.'),
  ('print_default', '"struk"'::jsonb, 'Format cetak default: "struk" (thermal) atau "nota" (A6/A5).'),
  ('promo_enabled', 'true'::jsonb, 'Tampilkan QR promosi (link-in-bio) di bagian bawah struk penjualan thermal.'),
  ('promo_text', '"Scan untuk ikuti kami!"'::jsonb, 'Teks ajakan yang dicetak di atas QR promosi.'),
  ('promo_url', '"https://berbagi.link/langitan.co"'::jsonb, 'Link tujuan QR promosi di struk, mis. https://linktr.ee/langitan.co. Kosong/tidak valid = QR tidak dicetak.'),
  ('rounding', '100'::jsonb, 'Pembulatan kembalian tunai ke kelipatan ini (rupiah).'),
  ('shift_default_cash', '0'::jsonb, 'Modal awal kas default saat kasir buka shift.'),
  ('show_cost_price', 'false'::jsonb, 'Tampilkan harga modal di layar yang butuh permission harga_modal (PRD §5).'),
  ('telepon', '"+62 851-8466-6545"'::jsonb, 'Nomor telepon toko, tampil di struk/nota.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- C2. Storage: bucket promo-media + policy (hasil migration 026/028/031).
--     Bucket payment-proofs TIDAK dibuat: fiturnya dihapus di migration 034.
--     Policy dan konfigurasi bucket sudah terverifikasi sama dengan produksi.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'promo-media', 'promo-media', true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS promo_media_storage_select ON storage.objects;
CREATE POLICY promo_media_storage_select ON storage.objects
  FOR SELECT
  USING (bucket_id = 'promo-media');

DROP POLICY IF EXISTS promo_media_storage_insert ON storage.objects;
CREATE POLICY promo_media_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'promo-media' AND e_pos.has_permission_action('promo', 'create'));

DROP POLICY IF EXISTS promo_media_storage_delete ON storage.objects;
CREATE POLICY promo_media_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'promo-media' AND e_pos.has_permission_action('promo', 'delete'));


-- =====================================================================
-- BAGIAN D -- PANDUAN: ADMIN PERTAMA (jalankan TERPISAH, setelah di atas)
-- =====================================================================
-- Tabel `profiles` TIDAK terhubung otomatis ke auth.users, jadi di schema
-- baru belum ada profil -> tidak ada yang bisa memakai aplikasi.
--   1. Dashboard -> Authentication -> Users -> Add user
--      (email + password, centang "Auto Confirm User").
--      Kalau email itu SUDAH ada (dipakai aplikasi lain), lewati langkah ini.
--   2. Jalankan (ganti email & nama):
--
-- INSERT INTO e_pos.profiles (id, full_name, email, roles, is_active)
-- SELECT id, 'Nama Admin', email, ARRAY['super_admin'], true
-- FROM auth.users
-- WHERE email = 'admin@contoh.com';
--
--   3. Login ke aplikasi, tambah user lain dari Pengaturan.

-- Beritahu PostgREST agar memuat ulang schema.
NOTIFY pgrst, 'reload schema';
