// Riwayat transfer stok antar outlet (migration 052). Menampilkan transfer yang
// melibatkan outlet aktif, baik sebagai asal maupun tujuan.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBranchScope } from "@/hooks/useActiveBranch";
import { BRANCH_MIGRATION_HINT } from "@/lib/pos/productBranchApi";
import { isMissingBranchInventoryError } from "@/lib/pos/productBranch";

const supabase = createClient();

export interface StockTransferItem {
  id: string;
  product_name: string;
  product_sku: string | null;
  product_unit: string | null;
  qty: number;
}

export interface StockTransfer {
  id: string;
  number: number;
  from_branch_id: string;
  to_branch_id: string;
  note: string | null;
  item_count: number;
  total_qty: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  items: StockTransferItem[];
}

const COLUMNS =
  "id, number, from_branch_id, to_branch_id, note, item_count, total_qty, created_by, created_at, items:stock_transfer_items(id, product_name, product_sku, product_unit, qty)";

const LIMIT = 100;

export function useStockTransfers() {
  const { branchId, ready } = useBranchScope();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!ready) return;
    setIsLoading(true);
    setError(null);

    let query = supabase
      .from("stock_transfers")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(LIMIT);

    if (branchId) {
      query = query.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(isMissingBranchInventoryError(fetchError) ? BRANCH_MIGRATION_HINT : fetchError.message);
      setTransfers([]);
      setIsLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as Omit<StockTransfer, "created_by_name">[];
    const creatorIds = Array.from(new Set(rows.map((r) => r.created_by).filter((id): id is string => !!id)));
    const nameById = new Map<string, string>();

    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", creatorIds);
      for (const p of profiles ?? []) {
        if (p.full_name) nameById.set(p.id, p.full_name);
      }
    }

    setTransfers(
      rows.map((r) => ({
        ...r,
        number: Number(r.number),
        item_count: Number(r.item_count),
        total_qty: Number(r.total_qty),
        created_by_name: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
        items: (r.items ?? []).map((i) => ({ ...i, qty: Number(i.qty) })),
      })),
    );
    setIsLoading(false);
  }, [branchId, ready]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pola fetch-on-mount yang sama dengan hook lain di app ini
    void fetchAll();
  }, [fetchAll]);

  return { transfers, isLoading, error, refetch: fetchAll };
}
