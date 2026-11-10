"use client";

// Isian pesanan untuk produk Jasa berharga bebas: deskripsi, jumlah, dan harga
// satuan yang ditentukan kasir. Aturan validasi ada di customLineError
// (lib/pos/cartLogic.ts) dan diulang di server (migration 055).

import { useId, useState, type FormEvent } from "react";
import { AlertCircle, X } from "lucide-react";
import type { ProductWithCategory } from "@/hooks/useProducts";
import {
  CUSTOM_NOTE_MAX_LENGTH,
  customLineError,
  formatRupiah,
  type CustomLineInput,
} from "@/lib/pos/cartLogic";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import Input from "@/app/components/ui/Input";
import MoneyInput from "@/app/components/ui/MoneyInput";

interface KasirCustomPriceModalProps {
  product: ProductWithCategory;
  initialQty: number;
  onConfirm: (input: CustomLineInput) => void;
  onClose: () => void;
}

const labelClass = "mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300";

export default function KasirCustomPriceModal({
  product,
  initialQty,
  onConfirm,
  onClose,
}: KasirCustomPriceModalProps) {
  const [note, setNote] = useState("");
  const [qtyRaw, setQtyRaw] = useState(String(initialQty));
  // Harga acuan produk jadi isian awal, kasir tinggal menyesuaikan.
  const [priceRaw, setPriceRaw] = useState(
    product.sell_price > 0 ? String(product.sell_price) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const titleId = useId();
  const noteId = useId();
  const qtyId = useId();
  const priceId = useId();

  const qty = Number(qtyRaw) || 0;
  const price = Number(priceRaw) || 0;
  const total = qty > 0 && price > 0 ? qty * price : 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input: CustomLineInput = { price, qty, note: note.trim() };
    const problem = customLineError(product, input);
    if (problem) {
      setError(problem);
      return;
    }
    onConfirm(input);
  }

  return (
    <Modal size="sm" layout="plain" aria-labelledby={titleId} onEscape={onClose}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 id={titleId} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {product.name}
        </h3>
        <IconButton type="button" onClick={onClose} aria-label="Tutup" size="sm">
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
      <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
        Harga jasa ini ditentukan per pesanan.
        {product.min_price != null && product.min_price > 0
          ? ` Harga satuan minimal ${formatRupiah(product.min_price)}.`
          : ""}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={noteId} className={labelClass}>
            Deskripsi pesanan
          </label>
          <Input
            id={noteId}
            autoFocus
            value={note}
            maxLength={CUSTOM_NOTE_MAX_LENGTH}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder="Contoh: Undangan 100 lembar A5"
            size="lg"
          />
        </div>

        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <div>
            <label htmlFor={qtyId} className={labelClass}>
              Jumlah
            </label>
            <MoneyInput
              id={qtyId}
              size="lg"
              maxDigits={5}
              value={qtyRaw}
              onValueChange={(raw) => {
                setQtyRaw(raw);
                setError(null);
              }}
              className="text-right font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor={priceId} className={labelClass}>
              Harga satuan (Rp)
            </label>
            <MoneyInput
              id={priceId}
              size="lg"
              value={priceRaw}
              onValueChange={(raw) => {
                setPriceRaw(raw);
                setError(null);
              }}
              placeholder="0"
              className="text-right font-mono tabular-nums"
            />
          </div>
        </div>

        <div className="flex items-baseline justify-between rounded-md bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Total pesanan</span>
          <span className="font-mono text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatRupiah(total)}
          </span>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 text-xs text-lco-coral"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="secondary" size="lg" onClick={onClose} className="flex-1">
            Batal
          </Button>
          <Button type="submit" size="lg" className="flex-1">
            Tambah ke keranjang
          </Button>
        </div>
      </form>
    </Modal>
  );
}
