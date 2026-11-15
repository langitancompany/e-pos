"use client";

// app/components/kasir/useKasirShiftSession.ts
// ── Dipecah dari KasirModule.tsx. Seluruh siklus sesi kas di layar Kasir:
// buka sesi (modal awal + struk awal otomatis), tutup sesi (modal + ringkasan
// selisih), kas masuk/keluar, dan pengunci cabang selama sesi terbuka.
// Isi dipindah apa adanya; struk Buka Kasir disusun oleh buildShiftOpenReceipt
// (lib/pos/kasirLogic.ts).

import { useEffect, useState } from "react";
import { useShifts, type CloseShiftResult } from "@/hooks/useShifts";
import {
  useCashMovements,
  type AddCashMovementParams,
} from "@/hooks/useCashMovements";
import { useActiveBranch } from "@/hooks/useActiveBranch";
import { buildShiftOpenReceipt, parseDigits } from "@/lib/pos/kasirLogic";
import { getReceiptBranding } from "./kasirReceiptBranding";
import { useShiftCloseReceipt } from "./useShiftCloseReceipt";
import type {
  KasirUser,
  OutletSettingsValue,
  PosSettings,
  PrintReceiptFn,
} from "./kasirHookTypes";

interface Params {
  posSettings: PosSettings;
  outlet: OutletSettingsValue;
  user: KasirUser;
  printReceipt: PrintReceiptFn;
  onExitKasir?: () => void;
}

export function useKasirShiftSession({
  posSettings,
  outlet,
  user,
  printReceipt,
  onExitKasir,
}: Params) {
  // Layar Kasir wajib mengecek shift aktif sebelum transaksi (PRD §17 T-04).
  // Pengecekan SEBENARNYA tetap di RPC create_transaction (migration 007) —
  // blokir di UI murni supaya UX jelas.
  const {
    activeShift,
    isLoading: isShiftLoading,
    openShift,
    closeShift,
  } = useShifts();

  // ── Multi cabang (migration 047) ── Selama sesi kas terbuka, kasir WAJIB
  // bekerja di cabang tempat sesi itu dibuka. Kalau cabang di Header sempat
  // diganti, kembalikan ke cabang sesi. Pindah cabang = tutup sesi dulu.
  const {
    branches: branchChoices,
    activeBranch,
    activeBranchId,
    setActiveBranch,
  } = useActiveBranch();
  const shiftBranchId = activeShift?.branch_id ?? null;
  useEffect(() => {
    if (shiftBranchId && shiftBranchId !== activeBranchId) {
      setActiveBranch(shiftBranchId);
    }
  }, [shiftBranchId, activeBranchId, setActiveBranch]);

  // ── Kas masuk/keluar dari laci (migration 040) ── `summary` hanya untuk
  // pengingat di modal Tutup Sesi Kas — TIDAK pernah menampilkan "kas
  // seharusnya" (penutupan kas dibuat "buta").
  const { summary: cashSummary, addMovement: addCashMovement } =
    useCashMovements(activeShift?.id ?? null);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const handleAddCashMovement = async (params: AddCashMovementParams) => {
    await addCashMovement(params);
  };

  // ── Buka sesi ──
  const [openingCashInput, setOpeningCashInput] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [openSessionError, setOpenSessionError] = useState<string | null>(null);

  // `null` = kasir belum mengetik apa pun, jadi tampilkan default Pengaturan
  // (shift_default_cash) — diturunkan saat render (bukan lewat useEffect)
  // supaya nilai Pengaturan yang datang belakangan tetap terpakai dan ketikan
  // kasir tidak pernah tertimpa. Kembali ke `null` setelah sesi dibuka.
  const openingCashValue =
    openingCashInput ?? String(posSettings.shiftDefaultCash || "");

  // ── Tutup sesi ── `closeResult` disimpan di sini (bukan di dalam modal)
  // karena begitu shift tertutup, layar pindah ke cabang tanpa-shift —
  // ringkasan selisih harus tetap tampil.
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseShiftResult | null>(null);

  // ── TAMBAHAN ── Struk Tutup Sesi dicetak otomatis begitu close_shift sukses.
  const printCloseReceipt = useShiftCloseReceipt({
    posSettings,
    outlet,
    user,
    printReceipt,
  });

  const handleCloseSession = async (actualCash: number, notes?: string) => {
    const openedAt = activeShift?.opened_at ?? null;
    const result = await closeShift(actualCash, notes);
    printCloseReceipt(result, openedAt);
    setIsStartingSession(false);
    setCloseResult(result);
    setIsCloseModalOpen(false);
  };

  const handleFinishCloseSession = () => {
    setCloseResult(null);
    onExitKasir?.();
  };

  // Buka shift + cetak "struk awal" otomatis. Begitu openShift() selesai,
  // `activeShift` terisi dan layar otomatis pindah ke transaksi POS.
  const handleStartSession = async () => {
    const amount = parseDigits(openingCashValue);
    if (amount <= 0) {
      setOpenSessionError("Masukkan nominal modal awal yang valid.");
      return;
    }

    setOpenSessionError(null);
    setIsStartingSession(true);
    try {
      await openShift(amount);

      const openingReceipt = buildShiftOpenReceipt({
        branding: getReceiptBranding(posSettings, outlet, {
          withPromo: false,
        }),
        now: new Date(),
        cashierName: user?.full_name ?? user?.email ?? null,
        openingCash: amount,
      });
      // Tidak perlu await — kegagalan printer tidak boleh memblokir kasir
      // mulai transaksi.
      void printReceipt(openingReceipt);

      setOpeningCashInput(null);
      // Modal hilang sendiri begitu `activeShift` terisi. `isStartingSession`
      // sengaja TIDAK di-reset di sini: openShift() tidak menunggu refetch,
      // jadi ada jeda sampai shift terlihat, dan tombol harus tetap terkunci
      // (cegah klik ganda). Reset dilakukan di handleCloseSession.
    } catch (err) {
      setOpenSessionError(
        err instanceof Error ? err.message : "Gagal membuka sesi kasir.",
      );
      setIsStartingSession(false);
    }
  };

  return {
    activeShift,
    isShiftLoading,
    // cabang
    branchChoices,
    activeBranch,
    activeBranchId,
    setActiveBranch,
    // kas masuk/keluar
    cashSummary,
    isCashModalOpen,
    setIsCashModalOpen,
    handleAddCashMovement,
    // buka sesi
    openingCashValue,
    setOpeningCashInput,
    isStartingSession,
    openSessionError,
    handleStartSession,
    // tutup sesi
    isCloseModalOpen,
    setIsCloseModalOpen,
    closeResult,
    handleCloseSession,
    handleFinishCloseSession,
  };
}
