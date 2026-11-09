"use client";

// Atur ketersediaan satu produk di outlet: aktifkan dengan stok awal,
// ubah minimum stok dan harga khusus, atau nonaktifkan di outlet tertentu.
// Stok berjalan tidak diubah dari sini (pakai Barang Masuk, Opname, atau Transfer).
// Dari pusat daftar berisi cabang yang bisa dipilih; dari cabang hanya cabang itu sendiri.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import MoneyInput from "@/app/components/ui/MoneyInput";
import type { Branch, OutletRole } from "@/lib/pos/branches";
import type { Product } from "@/lib/pos/types";
import {
  availabilityLabel,
  availabilityOf,
  validateBranchSetup,
  type ProductBranchRow,
} from "@/lib/pos/productBranch";
import {
  assignProductBranch,
  fetchProductBranchRows,
  updateProductBranch,
} from "@/lib/pos/productBranchApi";

interface Props {
  product: Pick<Product, "id" | "name" | "sku" | "type" | "is_service" | "sell_price" | "min_stock"> & {
    base_sell_price?: number;
  };
  /** Outlet yang boleh diatur dari outlet aktif (lihat productTargetBranches). */
  branches: Branch[];
  mode: OutletRole;
  canEdit: boolean;
  canSetStock: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const TITLE: Record<OutletRole, string> = {
  pusat: "Tambahkan di Cabang",
  cabang: "Atur di Outlet Ini",
  "tanpa-pusat": "Atur Outlet",
};

interface Draft {
  stock: string;
  minStock: string;
  price: string;
}

const toDraft = (row: ProductBranchRow | undefined, defaultMin: number): Draft => ({
  stock: "0",
  minStock: String(row?.min_stock ?? defaultMin),
  price: row?.price_override ? String(row.price_override) : "",
});

export default function ProductBranchesModal({
  product,
  branches,
  mode,
  canEdit,
  canSetStock,
  onClose,
  onChanged,
}: Props) {
  const isService = product.is_service || product.type === "JASA";
  const masterPrice = product.base_sell_price ?? product.sell_price;
  const usable = branches.filter((b) => b.is_active);

  const [rows, setRows] = useState<ProductBranchRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchProductBranchRows(product.id);
    setError(result.error);
    setRows(result.rows);
    setDrafts(
      Object.fromEntries(
        usable.map((b) => [b.id, toDraft(result.rows.find((r) => r.branch_id === b.id), product.min_stock)]),
      ),
    );
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- daftar outlet berubah hanya lewat reload outlet
  }, [product.id, product.min_stock, branches]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pola fetch-on-mount yang sama dengan hook lain di app ini
    void load();
  }, [load]);

  function patchDraft(branchId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [branchId]: { ...current[branchId], ...patch } }));
  }

  async function run(branchId: string, action: () => Promise<{ success: boolean; error?: string }>) {
    setBusyBranch(branchId);
    setError(null);
    const result = await action();
    setBusyBranch(null);
    if (!result.success) {
      setError(result.error ?? "Gagal menyimpan.");
      return;
    }
    onChanged();
    await load();
  }

  function parse(draft: Draft) {
    return {
      stock: Number(draft.stock || 0),
      minStock: Number(draft.minStock || 0),
      priceOverride: draft.price ? Number(draft.price) : null,
    };
  }

  function activate(branchId: string) {
    const parsed = parse(drafts[branchId]);
    const invalid = validateBranchSetup({ ...parsed, isService });
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(branchId, () =>
      assignProductBranch({
        productId: product.id,
        branchId,
        stock: parsed.stock,
        minStock: parsed.minStock,
        priceOverride: parsed.priceOverride,
      }),
    );
  }

  function save(branchId: string, row: ProductBranchRow) {
    const parsed = parse(drafts[branchId]);
    const invalid = validateBranchSetup({ stock: 0, minStock: parsed.minStock, priceOverride: parsed.priceOverride, isService });
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(branchId, () =>
      updateProductBranch({
        productId: product.id,
        branchId,
        minStock: isService ? undefined : parsed.minStock,
        priceOverride: parsed.priceOverride,
        clearPriceOverride: parsed.priceOverride === null && row.price_override !== null,
      }),
    );
  }

  function toggle(branchId: string, row: ProductBranchRow) {
    void run(branchId, () =>
      updateProductBranch({ productId: product.id, branchId, isActive: !row.is_active }),
    );
  }

  return (
    <Modal size="2xl" padding="none" layout="flex" aria-label={`Atur outlet ${product.name}`}>
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <ModalHeader title={TITLE[mode]} onClose={onClose} />
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {product.name} · <span className="font-mono">{product.sku}</span> · harga master{" "}
          <span className="font-mono tabular-nums">Rp {masterPrice.toLocaleString("id-ID")}</span>
        </p>
        {mode === "pusat" && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Produk hanya tampil di cabang yang Anda tambahkan di sini.
          </p>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {error && (
          <div className="flex items-start gap-2 border border-lco-coral/30 p-3 text-xs text-lco-coral">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat outlet...
          </div>
        ) : usable.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            {mode === "pusat"
              ? "Belum ada cabang aktif. Tambahkan cabang di Pengaturan > Outlet."
              : "Belum ada outlet aktif yang bisa Anda akses."}
          </p>
        ) : (
          usable.map((branch) => {
            const row = rows.find((r) => r.branch_id === branch.id);
            const status = availabilityOf(row);
            const draft = drafts[branch.id] ?? toDraft(row, product.min_stock);
            const busy = busyBranch === branch.id;

            return (
              <div
                key={branch.id}
                className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{branch.name}</p>
                    <p
                      className={`text-xs ${
                        status === "available"
                          ? "text-lco-green dark:text-lco-teal"
                          : "text-zinc-400"
                      }`}
                    >
                      {status === "unlisted" && mode === "pusat"
                        ? "Belum ditambahkan"
                        : availabilityLabel(status)}
                      {row && !isService ? ` · stok ${row.stock}` : ""}
                    </p>
                  </div>

                  {row && canEdit && (
                    <Button
                      type="button"
                      size="sm"
                      variant={row.is_active ? "outline-danger" : "secondary"}
                      disabled={busy}
                      onClick={() => toggle(branch.id, row)}
                    >
                      {row.is_active ? "Nonaktifkan" : "Aktifkan lagi"}
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {!row && !isService && (
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Stok awal
                      <Input
                        type="number"
                        min="0"
                        value={draft.stock}
                        disabled={busy || !canEdit || !canSetStock}
                        onChange={(e) => patchDraft(branch.id, { stock: e.target.value })}
                        className="mt-1 font-mono tabular-nums"
                      />
                    </label>
                  )}

                  {!isService && (
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Minimum stok
                      <Input
                        type="number"
                        min="0"
                        value={draft.minStock}
                        disabled={busy || !canEdit}
                        onChange={(e) => patchDraft(branch.id, { minStock: e.target.value })}
                        className="mt-1 font-mono tabular-nums"
                      />
                    </label>
                  )}

                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Harga khusus outlet
                    <MoneyInput
                      size="md"
                      value={draft.price}
                      onValueChange={(raw) => patchDraft(branch.id, { price: raw })}
                      disabled={busy || !canEdit}
                      placeholder="Pakai harga master"
                      className="mt-1 font-mono tabular-nums"
                    />
                  </label>
                </div>

                {canEdit && (
                  <div className="mt-3 flex justify-end">
                    {row ? (
                      <Button type="button" size="sm" disabled={busy} onClick={() => save(branch.id, row)}>
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Simpan
                      </Button>
                    ) : (
                      <Button type="button" size="sm" disabled={busy} onClick={() => activate(branch.id)}>
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {mode === "pusat" ? "Tambahkan di cabang ini" : "Aktifkan di outlet ini"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex justify-end border-t border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Button type="button" variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      </div>
    </Modal>
  );
}
