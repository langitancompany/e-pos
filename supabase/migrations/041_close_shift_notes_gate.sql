-- ============================================================================
-- 041_close_shift_notes_gate.sql
-- Tutup sesi kas: alasan selisih wajib, catatan penutupan, penutup sesi,
-- dan gerbang "masih ada pekerjaan belum selesai".
--
-- Yang berubah:
--   1. Kolom baru shift_sessions.closed_by (siapa yang menutup sesi; bisa
--      supervisor/lintas_kasir, bukan hanya pemilik sesi).
--   2. close_shift mendapat parameter ketiga p_notes (opsional, default NULL).
--      Panggilan lama dengan 2 parameter tetap jalan.
--   3. Selisih kas <> 0 tanpa catatan -> ditolak.
--   4. Penutupan ditolak selama kasir pemilik sesi masih punya:
--        - pesanan tahan (held_orders), atau
--        - pembayaran digital berstatus 'pending' yang dibuat sejak sesi dibuka.
--   5. Pengaman tambahan: pemanggil tanpa login ditolak, dan hak EXECUTE hanya
--      untuk role authenticated. (Versi lama tidak mengecek auth.uid() NULL.)
--
-- Rumus kas seharusnya TIDAK diubah: tetap dari public.shift_cash_totals().
-- Satu transaksi; aman dijalankan ulang.
-- ============================================================================

begin;

-- 1. Penutup sesi ---------------------------------------------------------
alter table public.shift_sessions
  add column if not exists closed_by uuid
    references public.profiles(id) on delete set null;

comment on column public.shift_sessions.closed_by is
  'User yang menekan tutup sesi (pemilik sesi atau role lintas_kasir). Diisi oleh close_shift.';

comment on column public.shift_sessions.notes is
  'Catatan sesi. Saat tutup: alasan selisih kas / catatan serah terima, diisi lewat close_shift(p_notes). Beberapa catatan digabung dengan " | ".';

-- 2. Ganti signature close_shift -------------------------------------------
-- Versi lama (uuid, bigint) dihapus supaya tidak ada dua overload yang
-- membingungkan PostgREST. Parameter ketiga punya default, jadi pemanggilan
-- supabase.rpc("close_shift", { p_shift_id, p_actual_cash }) tetap valid.
drop function if exists public.close_shift(uuid, bigint);

create or replace function public.close_shift(
  p_shift_id uuid,
  p_actual_cash bigint,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    v_can_force_close := public.current_role_lintas_kasir();

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
    v_totals := public.shift_cash_totals(p_shift_id);
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
$function$;

-- 3. Hak akses ---------------------------------------------------------------
-- Fungsi baru otomatis boleh dipanggil PUBLIC; cabut, lalu beri hanya ke user login.
revoke all on function public.close_shift(uuid, bigint, text) from public, anon;
grant execute on function public.close_shift(uuid, bigint, text) to authenticated;

commit;

-- Cek cepat setelah dijalankan (opsional):
--   select column_name from information_schema.columns
--    where table_name = 'shift_sessions' and column_name = 'closed_by';
--   select proname, pronargs from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'close_shift';
--   -- harus tepat 1 baris dengan pronargs = 3
