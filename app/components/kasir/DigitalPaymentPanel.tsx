"use client";

// app/components/kasir/DigitalPaymentPanel.tsx
// ── Dipecah dari PaymentModal.tsx — panel menunggu pembayaran digital (Midtrans).
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

import { Loader2, RefreshCw, ExternalLink, XCircle } from "lucide-react";
import type { MidtransOrder } from "@/lib/midtrans/client";
import Button from "@/app/components/ui/Button";
import { digitalStatusLabel, formatRp } from "./paymentUtils";

export default function DigitalPaymentPanel({
  digitalPhase,
  digitalOrder,
  digitalMidtransStatus,
  digitalNote,
  checkingDigital,
  cancellingDigital,
  onReopenSnap,
  onCheckStatus,
  onCancel,
}: {
  digitalPhase: "idle" | "creating" | "waiting";
  digitalOrder: MidtransOrder | null;
  digitalMidtransStatus: string | null;
  digitalNote: string | null;
  checkingDigital: boolean;
  cancellingDigital: boolean;
  onReopenSnap: () => void;
  onCheckStatus: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-lco-teal/30 bg-lco-teal/5 p-4">
      {digitalPhase === "creating" || !digitalOrder ? (
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Menyiapkan pembayaran digital...
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="w-4 h-4 animate-spin text-lco-teal shrink-0" />
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Menunggu pelanggan membayar
            </p>
          </div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Nominal</dt>
              <dd className="font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatRp(digitalOrder.amount)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500 shrink-0">Order ID</dt>
              <dd className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 break-all text-right">
                {digitalOrder.orderId}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Berlaku hingga</dt>
              <dd className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                {new Date(digitalOrder.expiresAt).toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Status</dt>
              <dd className="text-zinc-700 dark:text-zinc-300 text-right">
                {digitalStatusLabel(digitalMidtransStatus)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] text-zinc-500">
            Status dicek otomatis setiap 3 detik. Struk keluar sendiri begitu
            pembayaran lunas.
          </p>
          {digitalNote && (
            <p className="mt-2 text-[11px] text-lco-coral">{digitalNote}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={onReopenSnap}
              variant="secondary"
              size="sm"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Buka Pembayaran
            </Button>
            <Button
              type="button"
              onClick={onCheckStatus}
              disabled={checkingDigital}
              variant="secondary"
              size="sm"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${checkingDigital ? "animate-spin" : ""}`}
              />
              Cek Status
            </Button>
          </div>
          <Button
            type="button"
            onClick={onCancel}
            disabled={cancellingDigital}
            variant="outline-danger"
            size="sm"
            fullWidth
            className="mt-2"
          >
            {cancellingDigital ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            Batalkan Pembayaran Digital
          </Button>
        </>
      )}
    </div>
  );
}
