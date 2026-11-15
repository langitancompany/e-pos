"use client";

// app/components/kasir/KasirOpenSessionScreen.tsx
// ── Dipecah dari KasirModule.tsx (lihat catatan di file itu). Markup dipindah
// apa adanya, tanpa perubahan logika.
//
// Layar yang tampil selama TIDAK ada shift aktif: latar polos + modal "Mulai
// Sesi Kasir" yang langsung terbuka (tanpa layar peringatan "Kasir Belum
// Dibuka"). Begitu submit sukses, `activeShift` terisi dan KasirModule render
// ulang ke layar transaksi. Kalau kasir membatalkan modal, ia kembali ke
// Dashboard (`onExitKasir`). Setelah Tutup Sesi Kas, cabang ini juga yang
// tampil, dengan ringkasan selisih kas menggantikan modal buka.

import { AlertTriangle, Loader2, Unlock, Wallet, X } from "lucide-react";
import MoneyInput from "@/app/components/ui/MoneyInput";
import Select from "@/app/components/ui/Select";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import type { CloseShiftResult } from "@/hooks/useShifts";
import { CloseShiftSummaryModal } from "./CloseShiftModal";

interface BranchChoice {
  id: string;
  name: string;
  is_active: boolean;
}

interface KasirOpenSessionScreenProps {
  /** Ringkasan Tutup Sesi Kas; kalau terisi, ditampilkan menggantikan modal buka. */
  closeResult: CloseShiftResult | null;
  onFinishClose: () => void;
  /** Batal & kembali ke Dashboard. Tombol X disembunyikan kalau tidak ada. */
  onExitKasir?: () => void;
  // Cabang tempat sesi dibuka (migration 047): layar Kasir tidak punya
  // Header, jadi pilihan cabang disediakan di sini.
  branchChoices: BranchChoice[];
  activeBranch: { name: string } | null | undefined;
  activeBranchId: string | null;
  setActiveBranch: (id: string) => void;
  // Modal awal kas
  openingCashValue: string;
  setOpeningCashInput: (value: string) => void;
  isStartingSession: boolean;
  openSessionError: string | null;
  onStartSession: () => void | Promise<void>;
}

export default function KasirOpenSessionScreen({
  closeResult,
  onFinishClose,
  onExitKasir,
  branchChoices,
  activeBranch,
  activeBranchId,
  setActiveBranch,
  openingCashValue,
  setOpeningCashInput,
  isStartingSession,
  openSessionError,
  onStartSession,
}: KasirOpenSessionScreenProps) {
  return (
    <div className="h-full bg-zinc-100 dark:bg-zinc-950">
      {closeResult ? (
        <CloseShiftSummaryModal
          result={closeResult}
          onDone={onFinishClose}
        />
      ) : (
        <Modal size="sm" layout="plain">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Wallet className="h-4 w-4 text-lco-teal" />
              Mulai Sesi Kasir
            </h3>
            {onExitKasir && (
              <IconButton
                type="button"
                onClick={onExitKasir}
                disabled={isStartingSession}
                title="Batal & kembali ke Dashboard"
                aria-label="Batal & kembali ke Dashboard"
                size="sm"
              >
                <X className="h-4 w-4" />
              </IconButton>
            )}
          </div>

          {/* ── TAMBAHAN (migration 047) ── Cabang tempat sesi ini dibuka. Layar
              Kasir tidak punya Header, jadi pilihan cabang disediakan di sini. */}
          {branchChoices.length > 0 && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-zinc-500">
                Cabang
              </label>
              {branchChoices.filter((b) => b.is_active).length > 1 ? (
                <Select
                  fullWidth
                  value={activeBranchId ?? ""}
                  onChange={(e) => setActiveBranch(e.target.value)}
                  disabled={isStartingSession}
                  aria-label="Cabang untuk sesi kasir ini"
                >
                  {branchChoices
                    .filter((b) => b.is_active)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </Select>
              ) : (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {activeBranch?.name ?? "—"}
                </p>
              )}
            </div>
          )}

          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Modal awal kas
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-400">
              Rp
            </span>
            <MoneyInput
              autoFocus
              size="md"
              value={openingCashValue}
              onValueChange={setOpeningCashInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isStartingSession) {
                  void onStartSession();
                }
              }}
              placeholder="200.000"
              className="pl-9 font-mono tabular-nums"
            />
          </div>

          {openSessionError && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {openSessionError}
            </div>
          )}

          <Button
            type="button"
            onClick={onStartSession}
            disabled={isStartingSession}
            size="lg"
            fullWidth
            className="mt-5"
          >
            {isStartingSession ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
            Mulai Sesi Kasir
          </Button>
          <p className="mt-2 text-center text-[11px] text-zinc-400">
            Struk awal akan tercetak otomatis (jika printer terhubung).
          </p>
        </Modal>
      )}
    </div>
  );
}
