"use client";

// Form pindah stok dari outlet aktif ke outlet lain. Stok yang dipindah langsung
// berkurang di outlet asal dan bertambah di outlet tujuan; produk yang belum ada di
// outlet tujuan otomatis diaktifkan di sana.

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import type { ProductWithCategory } from "@/hooks/useProducts";
import type { Branch } from "@/lib/pos/branches";
import { validateTransfer } from "@/lib/pos/productBranch";
import { transferStock } from "@/lib/pos/productBranchApi";
import { formatNumber } from "./stokUtils";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Select from "@/app/components/ui/Select";

interface Line {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  available: number;
  qty: string;
}

interface Props {
  products: ProductWithCategory[];
  fromBranch: Branch;
  branches: Branch[];
  onBack: () => void;
  onSaved: (result: { transferId: string; number: number }) => void;
}

export default function TransferForm({ products, fromBranch, branches, onBack, onSaved }: Props) {
  const destinations = branches.filter((b) => b.is_active && b.id !== fromBranch.id);

  const [toBranchId, setToBranchId] = useState(destinations[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const used = new Set(lines.map((l) => l.productId));
    return products
      .filter(
        (p) =>
          !p.is_service &&
          p.type !== "JASA" &&
          p.branch_availability !== "unlisted" &&
          p.stock > 0 &&
          !used.has(p.id) &&
          (!keyword ||
            p.name.toLowerCase().includes(keyword) ||
            p.sku.toLowerCase().includes(keyword) ||
            (p.barcode ?? "").toLowerCase().includes(keyword)),
      )
      .slice(0, 8);
  }, [products, search, lines]);

  function addLine(product: ProductWithCategory) {
    setLines((current) => [
      ...current,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        available: product.stock,
        qty: "1",
      },
    ]);
    setSearch("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      available: l.available,
      qty: Number(l.qty),
    }));

    const invalid = validateTransfer(fromBranch.id, toBranchId || null, parsed);
    if (invalid) {
      setError(invalid);
      return;
    }

    setSaving(true);
    const result = await transferStock({
      fromBranchId: fromBranch.id,
      toBranchId,
      items: parsed.map((l) => ({ productId: l.productId, qty: l.qty })),
      note,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved({ transferId: result.transferId, number: result.number });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Kembali ke daftar transfer
      </button>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Dari outlet</p>
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {fromBranch.name}
          </p>
          <p className="mt-1 text-xs text-zinc-400">Ganti outlet aktif di header untuk memilih asal lain.</p>
        </div>

        <div>
          <label htmlFor="transfer-to" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Ke outlet
          </label>
          <Select
            id="transfer-to"
            size="lg"
            fullWidth
            value={toBranchId}
            disabled={saving || destinations.length === 0}
            onChange={(e) => setToBranchId(e.target.value)}
          >
            {destinations.length === 0 && <option value="">Tidak ada outlet lain</option>}
            {destinations.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="transfer-note" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Catatan (opsional)
          </label>
          <Input
            id="transfer-note"
            size="lg"
            value={note}
            disabled={saving}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Mis. kiriman mingguan"
          />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <label htmlFor="transfer-search" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Tambah produk
        </label>
        <Input
          id="transfer-search"
          size="lg"
          value={search}
          disabled={saving}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, SKU, atau barcode produk yang ada stoknya..."
        />

        {search.trim() && (
          <ul className="mt-2 divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {candidates.length === 0 ? (
              <li className="px-3 py-3 text-sm text-zinc-500">Tidak ada produk berstok yang cocok.</li>
            ) : (
              candidates.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addLine(p)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="font-mono text-xs text-zinc-400">
                        {p.sku} · stok {formatNumber(p.stock)}
                      </span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-zinc-400" />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        {lines.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:border-zinc-800">
                <th className="py-2">Produk</th>
                <th className="py-2 text-right">Stok</th>
                <th className="w-28 py-2 text-right">Jumlah</th>
                <th className="w-10 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {lines.map((line) => (
                <tr key={line.productId}>
                  <td className="py-2 pr-2">
                    <p className="font-medium">{line.name}</p>
                    <p className="font-mono text-xs text-zinc-400">{line.sku}</p>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-zinc-500">
                    {formatNumber(line.available)}
                  </td>
                  <td className="py-2 pl-2">
                    <Input
                      type="number"
                      min="1"
                      value={line.qty}
                      disabled={saving}
                      onChange={(e) =>
                        setLines((current) =>
                          current.map((l) => (l.productId === line.productId ? { ...l, qty: e.target.value } : l)),
                        )
                      }
                      className="text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Hapus ${line.name}`}
                      disabled={saving}
                      onClick={() => setLines((current) => current.filter((l) => l.productId !== line.productId))}
                      className="p-1 text-zinc-400 hover:text-lco-coral"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-lco-coral/30 p-3 text-xs text-lco-coral">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={saving} onClick={onBack}>
          Batal
        </Button>
        <Button type="submit" size="lg" disabled={saving || lines.length === 0 || !toBranchId}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Pindahkan Stok
        </Button>
      </div>
    </form>
  );
}
