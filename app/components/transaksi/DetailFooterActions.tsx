"use client";

// app/components/transaksi/DetailFooterActions.tsx
// ── Dipecah dari TransactionDetailModal.tsx — tombol cetak ulang, kirim WA, retur, dan void.
// Isi JSX dipindah apa adanya; state & handler tetap di TransactionDetailModal.tsx
// dan dikirim lewat props.

import {
  Ban,
  ChevronDown,
  Loader2,
  MessageCircle,
  Printer,
  Undo2,
} from "lucide-react";
import Button from "@/app/components/ui/Button";

export default function DetailFooterActions({
  isPrintDropdownOpen,
  onTogglePrintDropdown,
  onReprint,
  isSharingWa,
  onShareWhatsApp,
  showReturButton,
  onStartRetur,
  showVoidButton,
  onStartVoid,
}: {
  isPrintDropdownOpen: boolean;
  onTogglePrintDropdown: () => void;
  onReprint: (format: "thermal" | "nota") => void;
  isSharingWa: boolean;
  onShareWhatsApp: () => void;
  /** Punya izin retur DAN masih ada qty yang bisa diretur. */
  showReturButton: boolean;
  onStartRetur: () => void;
  /** Punya izin void DAN status masih PAID. */
  showVoidButton: boolean;
  onStartVoid: () => void;
}) {
  return (
    <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex flex-wrap gap-3">
      {/* Dropdown Cetak Ulang yang Mendukung Thermal dan Nota */}
      <div className="relative flex-1 min-w-32">
        <Button
          onClick={() => onTogglePrintDropdown()}
          variant="secondary"
          fullWidth
        >
          <Printer className="w-4 h-4" />
          Cetak Ulang
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${isPrintDropdownOpen ? "rotate-180" : ""}`}
          />
        </Button>

        {isPrintDropdownOpen && (
          <div className="absolute bottom-full left-0 w-full mb-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg overflow-hidden z-10">
            <button
              onClick={() => onReprint("thermal")}
              className="w-full text-left px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium transition-colors"
            >
              Struk Thermal
            </button>
            <button
              onClick={() => onReprint("nota")}
              className="w-full text-left px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium border-t border-zinc-100 dark:border-zinc-800 transition-colors"
            >
              Nota Kertas
            </button>
          </div>
        )}
      </div>

      {/* ── TAMBAHAN (T-08 lanjutan) ── Kirim struk digital ke WhatsApp.
              Tombol tetap aktif walau `detail.customer_phone` kosong —
              lihat catatan di handleShareWhatsApp(). */}
      <Button
        onClick={onShareWhatsApp}
        disabled={isSharingWa}
        variant="secondary"
        className="flex-1 min-w-32"
      >
        {isSharingWa ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <MessageCircle className="w-4 h-4" />
        )}
        Kirim WA
      </Button>

      {showReturButton && (
        <button
          onClick={onStartRetur}
          className="flex-1 min-w-32 flex items-center justify-center gap-2 py-2.5 rounded-md border border-lco-mustard/50 bg-white dark:bg-zinc-950 text-lco-mustard hover:bg-lco-mustard/10 text-xs font-semibold transition-colors duration-150"
        >
          <Undo2 className="w-4 h-4" />
          Retur
        </button>
      )}
      {showVoidButton && (
        <Button
          onClick={onStartVoid}
          variant="outline-danger"
          className="flex-1 min-w-32"
        >
          <Ban className="w-4 h-4" />
          Void
        </Button>
      )}
    </div>
  );
}
