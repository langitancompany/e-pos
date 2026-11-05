-- Migration 050: Rincian uang laci untuk sesi kas yang SUDAH DITUTUP.
--
-- Target schema: e_pos (sama dengan lib/supabase/config.ts). Aman dijalankan ulang.
--
-- Dipakai dialog "Detail Sesi Kas" (menu Sesi Kasir & Kas): modal awal,
-- penjualan tunai, refund retur (beserta daftarnya), kas masuk/keluar lainnya,
-- nama kasir, nama penutup, dan nama outlet.
--
-- Penutupan kas tetap "buta": fungsi ini MENOLAK sesi yang masih OPEN, jadi
-- kas seharusnya / penjualan tunai sesi berjalan tidak bisa diintip sebelum
-- ditutup. shift_cash_totals() sendiri tetap tidak diberi hak execute ke client.
--
-- Hak akses: pemilik sesi, atau role dengan izin lintas kasir; dan user harus
-- boleh mengakses cabang sesi itu (can_access_branch).

set search_path = e_pos, public;

create or replace function e_pos.shift_closed_detail(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'e_pos'
as $function$
declare
  v_caller  uuid := auth.uid();
  v_shift   record;
  v_totals  jsonb;
  v_refunds jsonb;
  v_cashier text;
  v_closer  text;
  v_branch  text;
begin
  if v_caller is null then
    raise exception 'Anda belum login';
  end if;

  select * into v_shift from shift_sessions where id = p_shift_id;
  if not found then
    raise exception 'Sesi kas tidak ditemukan';
  end if;

  if v_shift.cashier_id <> v_caller and not e_pos.current_role_lintas_kasir() then
    raise exception 'Anda tidak berhak melihat sesi kas ini';
  end if;

  if not e_pos.can_access_branch(v_shift.branch_id) then
    raise exception 'Anda tidak berhak mengakses outlet sesi kas ini';
  end if;

  if v_shift.status <> 'CLOSED' then
    raise exception 'Rincian kas baru tersedia setelah sesi ditutup';
  end if;

  v_totals := e_pos.shift_cash_totals(p_shift_id);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'receipt_no', t.receipt_no,
               'amount',     -pay.amount,
               'created_at', pay.created_at
             )
             order by pay.created_at
           ),
           '[]'::jsonb
         )
    into v_refunds
  from payments pay
  join transactions t on t.id = pay.transaction_id
  where t.shift_id = p_shift_id
    and pay.method = 'CASH'
    and pay.amount < 0
    and t.status <> 'VOID';

  select full_name into v_cashier from profiles where id = v_shift.cashier_id;
  select full_name into v_closer  from profiles where id = v_shift.closed_by;
  select name      into v_branch  from branches where id = v_shift.branch_id;

  return jsonb_build_object(
    'shift_id',     p_shift_id,
    'opening_cash', (v_totals->>'opening_cash')::bigint,
    'cash_sales',   (v_totals->>'cash_sales')::bigint,
    'cash_refunds', (v_totals->>'cash_refunds')::bigint,
    'cash_in',      (v_totals->>'cash_in')::bigint,
    'cash_out',     (v_totals->>'cash_out')::bigint,
    'expected_cash', v_shift.expected_cash,
    'actual_cash',   v_shift.actual_cash,
    'difference',    v_shift.difference,
    'refunds',      v_refunds,
    'cashier_name', v_cashier,
    'closed_by_name', v_closer,
    'branch_name',  v_branch
  );
end;
$function$;

revoke all on function e_pos.shift_closed_detail(uuid) from public, anon;
grant execute on function e_pos.shift_closed_detail(uuid) to authenticated;

comment on function e_pos.shift_closed_detail(uuid) is
  'Rincian kas satu sesi yang SUDAH ditutup (menolak sesi OPEN supaya penutupan tetap buta). Migration 050.';


-- ---------------------------------------------------------------------------
-- Penjualan tunai banyak sesi sekaligus (kolom "Penjualan tunai" di riwayat).
-- Hanya sesi CLOSED milik pemanggil (atau lintas kasir) di cabang yang boleh
-- diakses; sesi lain dilewati diam-diam. Hasil: {"<shift_id>": <cash_sales>, ...}
-- ---------------------------------------------------------------------------
create or replace function e_pos.shift_closed_cash_sales(p_shift_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'e_pos'
as $function$
declare
  v_caller uuid := auth.uid();
  v_lintas boolean;
  v_result jsonb := '{}'::jsonb;
  v_row    record;
begin
  if v_caller is null then
    raise exception 'Anda belum login';
  end if;

  v_lintas := e_pos.current_role_lintas_kasir();

  for v_row in
    select s.id
    from shift_sessions s
    where s.id = any(p_shift_ids)
      and s.status = 'CLOSED'
      and (s.cashier_id = v_caller or v_lintas)
      and e_pos.can_access_branch(s.branch_id)
  loop
    v_result := v_result || jsonb_build_object(
      v_row.id::text,
      (e_pos.shift_cash_totals(v_row.id)->>'cash_sales')::bigint
    );
  end loop;

  return v_result;
end;
$function$;

revoke all on function e_pos.shift_closed_cash_sales(uuid[]) from public, anon;
grant execute on function e_pos.shift_closed_cash_sales(uuid[]) to authenticated;

-- Cek cepat (opsional):
--   select e_pos.shift_closed_detail('<id sesi yang sudah ditutup>');
