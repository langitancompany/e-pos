"use client";

// app/components/kasir/SplitPaymentForm.tsx
// ── Dipecah dari PaymentModal.tsx — form split bayar (beberapa metode sekaligus).
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import { User, Phone } from "lucide-react";
import type { PaymentMethod } from "@/lib/pos/transactionApi";
import MoneyInput from "@/app/components/ui/MoneyInput";
import { methodLabel, formatRp } from "./paymentUtils";
import type { METHODS } from "./paymentUtils";

export default function SplitPaymentForm({
  availableMethods,
  lockInputs,
  total,
  splitOn,
  selectedMethods,
  splitAmount,
  splitCashReceived,
  splitCashChange,
  tempoAmount,
  splitPaidSum,
  dueDate,
  customerName,
  customerPhone,
  onToggleMethod,
  onFillRemainder,
  onAmountChange,
  onCashReceivedChange,
  onDueDateChange,
  onCustomerNameChange,
  onCustomerPhoneChange,
}: {
  availableMethods: typeof METHODS;
  lockInputs: boolean;
  total: number;
  splitOn: Record<PaymentMethod, boolean>;
  selectedMethods: PaymentMethod[];
  splitAmount: Record<PaymentMethod, number>;
  splitCashReceived: number;
  splitCashChange: number;
  tempoAmount: number;
  splitPaidSum: number;
  dueDate: string;
  customerName: string;
  customerPhone: string;
  onToggleMethod: (method: PaymentMethod) => void;
  onFillRemainder: (method: PaymentMethod) => void;
  onAmountChange: (method: PaymentMethod, value: number) => void;
  onCashReceivedChange: (value: number) => void;
  onDueDateChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  onCustomerPhoneChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          Pilih Metode{" "}
          <span className="normal-case font-normal text-zinc-400">
            (minimal 2)
          </span>
        </label>
        <div
          className={`grid gap-2 ${availableMethods.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
        >
          {availableMethods.map(({ value, label, icon: Icon }) => {
            const on = splitOn[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => onToggleMethod(value)}
                disabled={lockInputs}
                aria-pressed={on}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-lco-teal bg-zinc-50 dark:bg-zinc-900 text-lco-teal" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal/50"}`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium text-[11px] text-center leading-tight">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedMethods.map((m) => (
        <div
          key={m}
          data-split-row={m}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {methodLabel(m)}
            </span>
            {m !== "TEMPO" && (
              <button
                type="button"
                onClick={() => onFillRemainder(m)}
                disabled={lockInputs}
                className="text-[11px] font-medium text-lco-teal hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                Isi sisa
              </button>
            )}
          </div>

          {m === "TEMPO" ? (
            <>
              <div className="flex items-center justify-between rounded-md bg-lco-coral/10 border border-lco-coral/30 px-3 py-2.5">
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  Piutang (sisa otomatis)
                </span>
                <span
                  data-testid="tempo-amount"
                  className="font-mono text-sm font-semibold tabular-nums text-lco-coral"
                >
                  {formatRp(tempoAmount)}
                </span>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Tanggal Jatuh Tempo <span className="text-lco-coral">*</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => onDueDateChange(e.target.value)}
                  disabled={lockInputs}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full px-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                />
              </div>
            </>
          ) : (
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-400">
                Rp
              </span>
              <MoneyInput
                aria-label={`Nominal ${methodLabel(m)}`}
                value={splitAmount[m] || ""}
                onValueChange={(raw) => onAmountChange(m, Number(raw))}
                disabled={lockInputs}
                placeholder="0"
                className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
              />
            </div>
          )}

          {m === "CASH" && (
            <div className="space-y-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Uang Diterima{" "}
                <span className="normal-case font-normal text-zinc-400">
                  (kosong = uang pas)
                </span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-400">
                  Rp
                </span>
                <MoneyInput
                  aria-label="Uang diterima tunai"
                  value={splitCashReceived || ""}
                  onValueChange={(raw) => onCashReceivedChange(Number(raw))}
                  disabled={lockInputs}
                  placeholder="0"
                  className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-base tabular-nums text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                />
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">Kembalian</span>
                <span
                  data-testid="split-change"
                  className="font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100"
                >
                  {formatRp(splitCashChange)}
                </span>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Ringkasan: selalu terlihat supaya kasir tahu berapa yang masih kurang. */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">Total tagihan</span>
          <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatRp(total)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Terbayar</span>
          <span
            data-testid="split-paid"
            className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100"
          >
            {formatRp(splitPaidSum)}
          </span>
        </div>
        <div className="flex justify-between font-semibold">
          <span className="text-zinc-500">
            {total - splitPaidSum < 0 ? "Kelebihan" : "Masih kurang"}
          </span>
          <span
            data-testid="split-remaining"
            className={`font-mono tabular-nums ${total - splitPaidSum === 0 ? "text-lco-green" : "text-lco-coral"}`}
          >
            {formatRp(Math.abs(total - splitPaidSum))}
          </span>
        </div>
      </div>

      {/* Identitas pelanggan — satu set untuk seluruh transaksi. Nama
                WAJIB kalau ada baris TEMPO (aturan RPC). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            Nama Pelanggan{" "}
            {splitOn.TEMPO ? (
              <span className="text-lco-coral">*</span>
            ) : (
              <span className="normal-case font-normal text-zinc-400">
                (opsional)
              </span>
            )}
          </label>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              aria-label="Nama pelanggan"
              value={customerName}
              onChange={(e) => onCustomerNameChange(e.target.value)}
              disabled={lockInputs}
              placeholder="Nama"
              className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            No. HP{" "}
            <span className="normal-case font-normal text-zinc-400">
              (opsional)
            </span>
          </label>
          <div className="relative">
            <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="tel"
              aria-label="No. HP pelanggan"
              value={customerPhone}
              onChange={(e) => onCustomerPhoneChange(e.target.value)}
              disabled={lockInputs}
              placeholder="08xxxxxxxxxx"
              className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
