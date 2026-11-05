"use client";

// app/components/kasir/SinglePaymentForm.tsx
// ── Dipecah dari PaymentModal.tsx — form pembayaran satu metode (Tunai / Digital / Piutang).
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import { QrCode, CalendarClock, User, Phone } from "lucide-react";
import type { PaymentMethod } from "@/lib/pos/transactionApi";
import MoneyInput from "@/app/components/ui/MoneyInput";
import Button from "@/app/components/ui/Button";
import { formatRp } from "./paymentUtils";
import type { METHODS } from "./paymentUtils";

export default function SinglePaymentForm({
  availableMethods,
  method,
  onMethodChange,
  lockInputs,
  total,
  customerName,
  onCustomerNameChange,
  customerPhone,
  onCustomerPhoneChange,
  dueDate,
  onDueDateChange,
  paidAmount,
  onPaidAmountChange,
  changeAmount,
}: {
  availableMethods: typeof METHODS;
  method: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
  lockInputs: boolean;
  total: number;
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  customerPhone: string;
  onCustomerPhoneChange: (value: string) => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;
  paidAmount: number;
  onPaidAmountChange: (value: number) => void;
  changeAmount: number;
}) {
  return (
    <>
      <div
        className={`grid gap-2 mb-6 ${availableMethods.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {availableMethods.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => onMethodChange(value)}
            disabled={lockInputs}
            className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${method === value ? "border-lco-teal bg-zinc-50 dark:bg-zinc-900 text-lco-teal" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 hover:border-lco-teal/50"}`}
          >
            <Icon className="w-5 h-5" />
            <span className="font-medium text-[11px] text-center leading-tight">
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* ── TAMBAHAN (013) ── Identitas pelanggan opsional (PRD §4.2), khusus
            di sini untuk metode SELAIN TEMPO — TEMPO sudah punya field Nama
            wajib + field HP opsional sendiri di bloknya masing-masing di
            bawah, jadi tidak perlu field nama dobel. */}
      {method !== "TEMPO" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Nama Pelanggan{" "}
              <span className="normal-case font-normal text-zinc-400">
                (opsional)
              </span>
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
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
                value={customerPhone}
                onChange={(e) => onCustomerPhoneChange(e.target.value)}
                disabled={lockInputs}
                placeholder="08xxxxxxxxxx"
                className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      )}

      {method === "CASH" && (
        <div className="space-y-5">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Uang Diterima
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-400">
                Rp
              </span>
              <MoneyInput
                value={paidAmount || ""}
                onValueChange={(raw) => onPaidAmountChange(Number(raw))}
                disabled={lockInputs}
                className="w-full pl-12 pr-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                placeholder="0"
                autoFocus
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Button
              onClick={() => onPaidAmountChange(total)}
              disabled={lockInputs}
              variant="secondary"
              size="sm"
            >
              Uang Pas
            </Button>
            <button
              onClick={() => onPaidAmountChange(50000)}
              disabled={lockInputs}
              className="py-2 px-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-lco-teal/50 rounded-md text-xs font-mono tabular-nums font-medium transition-colors duration-150 text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              50.000
            </button>
            <button
              onClick={() => onPaidAmountChange(100000)}
              disabled={lockInputs}
              className="py-2 px-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-lco-teal/50 rounded-md text-xs font-mono tabular-nums font-medium transition-colors duration-150 text-zinc-700 dark:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              100.000
            </button>
          </div>
          <div className="flex justify-between items-center p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2">
            <span className="text-xs font-medium text-zinc-500">Kembalian</span>
            <span
              className={`font-mono text-xl font-semibold tabular-nums ${changeAmount < 0 ? "text-lco-coral" : "text-zinc-900 dark:text-zinc-100"}`}
            >
              {changeAmount < 0 ? "Rp 0" : formatRp(changeAmount)}
            </span>
          </div>
        </div>
      )}

      {method === "DIGITAL" && (
        <div className="p-4 bg-lco-mustard/10 rounded-xl border border-lco-mustard/30 text-center">
          <QrCode className="w-6 h-6 mx-auto text-lco-mustard mb-2" />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Nominal dibayar penuh sebesar{" "}
            <span className="font-mono font-semibold">{formatRp(total)}</span>{" "}
            lewat pembayaran digital (Virtual Account, QRIS, dll. via Midtrans).
            Transaksi baru tersimpan setelah pembayaran lunas.
          </p>
        </div>
      )}

      {method === "TEMPO" && (
        <div className="space-y-4">
          <div className="p-4 bg-lco-coral/10 rounded-xl border border-lco-coral/30 text-center">
            <CalendarClock className="w-6 h-6 mx-auto text-lco-coral mb-2" />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Transaksi tercatat sebagai piutang sebesar{" "}
              <span className="font-mono font-semibold">{formatRp(total)}</span>
              . Nama &amp; jatuh tempo wajib diisi.
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Nama Pelanggan <span className="text-lco-coral">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                value={customerName}
                onChange={(e) => onCustomerNameChange(e.target.value)}
                disabled={lockInputs}
                placeholder="Nama pelanggan"
                className="w-full pl-11 pr-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
              />
            </div>
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
              className="w-full px-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              No. HP{" "}
              <span className="normal-case font-normal text-zinc-400">
                (opsional, untuk kirim struk &amp; tagih WA)
              </span>
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => onCustomerPhoneChange(e.target.value)}
                disabled={lockInputs}
                placeholder="08xxxxxxxxxx"
                className="w-full pl-11 pr-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-lco-teal focus:border-lco-teal transition-colors duration-150 font-mono text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
