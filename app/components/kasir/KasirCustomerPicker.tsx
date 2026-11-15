"use client";

// app/components/kasir/KasirCustomerPicker.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Pemilih pelanggan opsional di panel Produk (mode Tablet) + notifikasi poin
// loyalitas. Mengembalikan Fragment: elemen-elemennya tetap anak langsung dari
// container flex-col gap-4 di KasirProductPanel, jadi jarak antar elemen sama
// seperti sebelum dipecah.

import { Sparkles, UserRound, X } from "lucide-react";
import type { Customer } from "@/hooks/useCustomers";
import { formatRupiah } from "@/lib/pos/cartLogic";

interface KasirCustomerPickerProps {
  selectedCustomer: Customer | null;
  customerQuery: string;
  onQueryChange: (value: string) => void;
  isCustomerDropdownOpen: boolean;
  onDropdownOpenChange: (open: boolean) => void;
  matchingCustomers: Customer[];
  onSelectCustomer: (customer: Customer) => void;
  onClearCustomer: () => void;
  // Poin loyalitas
  loyaltyEnabled: boolean;
  usePoints: boolean;
  onUsePointsChange: (use: boolean) => void;
  isLoyaltyNoticeDismissed: boolean;
  onDismissLoyaltyNotice: () => void;
  pointsBeingUsed: number;
  /** Total potongan yang sedang berlaku (dipakai di teks "Memakai N poin = Rp ..."). */
  discount: number;
}

export default function KasirCustomerPicker({
  selectedCustomer,
  customerQuery,
  onQueryChange,
  isCustomerDropdownOpen,
  onDropdownOpenChange,
  matchingCustomers,
  onSelectCustomer,
  onClearCustomer,
  loyaltyEnabled,
  usePoints,
  onUsePointsChange,
  isLoyaltyNoticeDismissed,
  onDismissLoyaltyNotice,
  pointsBeingUsed,
  discount,
}: KasirCustomerPickerProps) {
  return (
    <>
      {/* ── TAMBAHAN (Fase 2: Memilih Pelanggan, opsional) ── */}
      <div className="relative">
        {selectedCustomer ? (
          <div className="flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-800 text-white px-3 py-2">
            <UserRound className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium truncate">
              {selectedCustomer.name}
            </span>
            {selectedCustomer.loyalty_points > 0 && (
              <span className="shrink-0 rounded bg-lco-mustard/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {selectedCustomer.loyalty_points} poin
              </span>
            )}
            <button
              type="button"
              aria-label="Hapus pelanggan"
              onClick={onClearCustomer}
              title="Hapus pelanggan"
              className="ml-auto text-zinc-400 hover:text-white transition-colors duration-150"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Cari nama pelanggan (opsional)..."
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:border-lco-teal focus:ring-2 focus:ring-lco-teal transition-colors duration-150 text-sm"
              value={customerQuery}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={() => onDropdownOpenChange(true)}
              onBlur={() =>
                setTimeout(() => onDropdownOpenChange(false), 150)
              }
            />
            {isCustomerDropdownOpen && customerQuery.trim() && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 shadow-lg max-h-56 overflow-y-auto">
                {matchingCustomers.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-zinc-400">
                    Pelanggan tidak ditemukan.
                  </p>
                ) : (
                  matchingCustomers.map((c) => (
                    <button
                      key={c.id}
                      onMouseDown={() => onSelectCustomer(c)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors duration-150"
                    >
                      <span>{c.name}</span>
                      {c.loyalty_points > 0 && (
                        <span className="text-[10px] font-semibold text-lco-mustard">
                          {c.loyalty_points} poin
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── TAMBAHAN (Fase 2: notifikasi poin loyalitas) ── Muncul kalau
      pelanggan terpilih punya poin, dan belum dipakai/ditutup. */}
      {loyaltyEnabled &&
        selectedCustomer &&
        selectedCustomer.loyalty_points > 0 &&
        !usePoints &&
        !isLoyaltyNoticeDismissed && (
          <div className="flex items-center gap-3 rounded-md border border-lco-mustard/30 bg-lco-mustard/10 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
            <Sparkles className="w-4 h-4 shrink-0 text-lco-mustard" />
            <span className="flex-1">
              <strong>{selectedCustomer.name}</strong> punya{" "}
              <strong>{selectedCustomer.loyalty_points} poin</strong>{" "}
              loyalitas — bisa dipakai sebagai potongan harga.
            </span>
            <button
              onClick={() => onUsePointsChange(true)}
              className="shrink-0 rounded-md bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white"
            >
              Gunakan Poin
            </button>
            <button
              onClick={onDismissLoyaltyNotice}
              className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              Nanti saja
            </button>
          </div>
        )}
      {loyaltyEnabled && usePoints && selectedCustomer && (
        <div className="flex items-center gap-3 rounded-md border border-lco-teal/30 bg-lco-teal/10 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
          <Sparkles className="w-4 h-4 shrink-0 text-lco-teal" />
          <span className="flex-1">
            Memakai <strong>{pointsBeingUsed} poin</strong> ={" "}
            <strong>{formatRupiah(discount)}</strong> potongan.
          </span>
          <button
            onClick={() => onUsePointsChange(false)}
            className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            Batalkan
          </button>
        </div>
      )}
    </>
  );
}
