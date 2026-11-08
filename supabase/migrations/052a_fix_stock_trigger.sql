-- Perbaikan untuk 052 yang sudah terlanjur dijalankan: trigger penerapan stok per outlet
-- gagal pada mutasi negatif (penjualan, transfer keluar, dst) karena CHECK stock >= 0
-- diperiksa pada baris yang diusulkan sebelum ON CONFLICT. Aman dijalankan ulang.
-- Tidak perlu dijalankan kalau Anda menjalankan 052 versi terbaru dari awal.

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

  insert into e_pos.product_branches (product_id, branch_id, stock, is_active)
  values (new.product_id, new.branch_id, greatest(new.qty_delta, 0),
          new.type in ('initial', 'stock_in', 'transfer_in'))
  on conflict (product_id, branch_id) do update
    set stock = e_pos.product_branches.stock + new.qty_delta,
        updated_at = now();

  return new;
end;
$$;
