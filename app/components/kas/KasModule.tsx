"use client";

// ── PERUBAHAN (Sesi Kasir & Kas) ── Menu ini ditata ulang mengikuti aplikasi
// acuan (rekaman layar): kartu "Sesi kas Anda #N", tombol Lanjut ke kasir /
// Tarik-setor kas / Tutup Sesi Kas, lalu "Riwayat sesi kas" (cari, filter,
// dikelompokkan per tanggal, Lihat detail).
//
// BEDA SENGAJA dari aplikasi acuan:
// 1. TIDAK ada tombol "Mulai Sesi Kasir" di sini. Sesi hanya dibuka saat kasir
//    menekan Buka Kasir (modal awal + struk Buka Kasir ada di layar Kasir).
// 2. "Kas seharusnya" sesi yang sedang berjalan TIDAK ditampilkan (penutupan
//    "buta"): kasir menghitung uang fisik dulu, baru sistem membandingkan.
//    Karena itu panel kanan hanya memuat angka yang kasir tahu sendiri (modal
//    awal, kas masuk/keluar yang ia catat), TANPA penjualan tunai/refund.
//    Angka seharusnya + selisih baru muncul setelah sesi ditutup (ringkasan,
//    struk Tutup Sesi, dan riwayat).
// 3. Tutup Sesi dari sini juga mencetak struk Tutup Sesi otomatis.

import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Loader2,
  AlertTriangle,
  Clock,
  Inbox,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Lock,
  RefreshCw,
  Search,
  Store,
  User as UserIcon,
  Calendar,
  X,
} from "lucide-react";
import {
  useShifts,
  type ShiftSession,
  type CloseShiftResult,
  type ShiftClosedDetail,
  fetchShiftClosedDetail,
  useClosedCashSales,
} from "@/hooks/useShifts";
import {
  useCashMovements,
  useCashTotalsByShift,
  categoryLabel,
  type CashMovement,
} from "@/hooks/useCashMovements";
import { useActiveBranch } from "@/hooks/useActiveBranch";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import { usePrinterProfiles } from "@/hooks/usePrinterProfiles";
import { CashMovementModal } from "@/app/components/kasir/CashMovementModal";
import { useShiftCloseReceipt } from "@/app/components/kasir/useShiftCloseReceipt";
import { formatRupiah } from "@/lib/pos/cartLogic";
import {
  CloseShiftModal,
  CloseShiftSummaryModal,
  differenceColorClass,
  differenceLabel,
} from "@/app/components/kasir/CloseShiftModal";
import Modal from "@/app/components/ui/Modal";
import IconButton from "@/app/components/ui/IconButton";
import Button from "@/app/components/ui/Button";
import Textarea from "@/app/components/ui/Textarea";
import Input from "@/app/components/ui/Input";
import Select from "@/app/components/ui/Select";
import TabSwitcher from "@/app/components/ui/TabSwitcher";

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

function formatClock(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(isoString))
    .replace(":", ".");
}

function formatLongDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(isoString));
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** "0 mnt", "35 mnt", "2 j 10 mnt". */
function formatDuration(fromIso: string, toIso: string | null, nowMs: number) {
  const end = toIso ? new Date(toIso).getTime() : nowMs;
  const minutes = Math.max(
    0,
    Math.floor((end - new Date(fromIso).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} mnt`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} j` : `${h} j ${m} mnt`;
}

// --------------------------------------------------------
// Modal: batalkan satu catatan kas (alasan wajib)
// --------------------------------------------------------

function VoidCashMovementModal({
  movement,
  onClose,
  onConfirm,
}: {
  movement: CashMovement;
  onClose: () => void;
  /** Dilempar Error (pesan server) kalau ditolak — ditampilkan di modal. */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = reason.trim().length >= 3;

  const handleConfirm = async () => {
    if (isSubmitting || !isValid) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan catatan kas.");
      setIsSubmitting(false);
    }
    // Sukses: pemanggil menutup modal ini (komponen ter-unmount), jadi tidak
    // ada setState lagi di sini.
  };

  return (
    <Modal
      size="sm"
      layout="plain"
      aria-label="Batalkan catatan kas"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">Batalkan Catatan Kas</h3>
        <IconButton
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Tutup"
          size="sm"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="mb-3 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          {movement.type === "IN" ? "Kas masuk" : "Kas keluar"} ·{" "}
          {categoryLabel(movement.category)} ·{" "}
          <span className="font-mono tabular-nums">
            {formatRupiah(movement.amount)}
          </span>
        </p>
        <p className="mt-1 text-zinc-500">{movement.note}</p>
      </div>

      <p className="mb-2 text-xs text-zinc-500">
        Catatan yang dibatalkan tidak dihitung lagi di kas shift ini, tetapi
        tetap tersimpan di riwayat dan Log Aktivitas.
      </p>

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Alasan pembatalan (wajib)
      </label>
      <Textarea
        rows={2}
        value={reason}
        disabled={isSubmitting}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Alasan pembatalan"
      />

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <Button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          variant="secondary"
          size="lg"
          className="flex-1"
        >
          Kembali
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting || !isValid}
          variant="outline-danger"
          size="lg"
          className="flex-1"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Membatalkan...
            </>
          ) : (
            "Batalkan Catatan"
          )}
        </Button>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------
// Modal: detail satu sesi (mengikuti aplikasi acuan)
// --------------------------------------------------------

function formatFullDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString("id-ID", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ShiftDetailModal({
  shift,
  number,
  branchName,
  cashierName,
  openTotals,
  nowMs,
  onClose,
}: {
  shift: ShiftSession;
  number: number | null;
  branchName: string;
  cashierName: string;
  /** Kas masuk/keluar (dipakai untuk sesi berjalan). */
  openTotals?: { cashIn: number; cashOut: number };
  nowMs: number;
  onClose: () => void;
}) {
  const isOpen = shift.status === "OPEN";
  const [detail, setDetail] = useState<ShiftClosedDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isRefundOpen, setIsRefundOpen] = useState(false);

  // Sesi yang sudah ditutup: rincian lengkap dari server (migration 050).
  // Sesi berjalan TIDAK diminta, supaya kas seharusnya tidak terlihat.
  useEffect(() => {
    if (isOpen) return;
    let isCancelled = false;
    fetchShiftClosedDetail(shift.id)
      .then((result) => {
        if (!isCancelled) setDetail(result);
      })
      .catch((err) => {
        if (!isCancelled) {
          setDetailError(
            err instanceof Error ? err.message : "Gagal memuat detail sesi kas.",
          );
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [isOpen, shift.id]);

  const closedBy = detail?.closed_by_name ?? null;
  const displayCashier = detail?.cashier_name ?? cashierName;
  const displayBranch = detail?.branch_name ?? branchName;
  const refunds = detail?.refunds ?? [];

  const infoRow = (label: string, value: string) => (
    <div className="flex items-center justify-between border-b border-zinc-100 py-3 text-sm dark:border-zinc-900">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
  const moneyRow = (label: string, value: string, bold = false) => (
    <div className="flex items-center justify-between border-b border-zinc-100 py-2.5 text-sm last:border-b-0 dark:border-zinc-900">
      <span className={bold ? "font-semibold" : "text-zinc-500"}>{label}</span>
      <span className={`font-mono tabular-nums ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );

  return (
    <Modal size="2xl" layout="plain" padding="none" aria-label="Detail sesi kas">
      <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-lco-teal">
            <Clock className="h-4 w-4" />
            Detail Sesi Kas {number ? `#${number}` : ""}
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {displayBranch} · Kasir:{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {displayCashier}
            </span>
          </p>
        </div>
        <IconButton type="button" onClick={onClose} aria-label="Tutup" size="sm">
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="grid gap-6 px-6 py-5 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-zinc-100 px-2 py-1 font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {isOpen ? "Sedang Berjalan" : "Sudah Ditutup"}
            </span>
            {!isOpen && closedBy && (
              <span className="text-zinc-500">Ditutup oleh {closedBy}</span>
            )}
          </div>

          <h4 className="mt-4 text-sm font-semibold">Waktu & durasi</h4>
          {infoRow("Waktu dibuka", formatFullDateTime(shift.opened_at))}
          {infoRow(
            "Waktu ditutup",
            shift.closed_at ? formatFullDateTime(shift.closed_at) : "Belum ditutup",
          )}
          {infoRow(
            "Durasi sesi kas",
            formatDuration(shift.opened_at, shift.closed_at, nowMs),
          )}

          {!isOpen && (
            <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-900">
              <button
                type="button"
                onClick={() => setIsRefundOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left text-sm font-semibold"
                aria-expanded={isRefundOpen}
              >
                <span className="text-[10px]">{isRefundOpen ? "▼" : "▶"}</span>
                Refund retur dari laci kasir ({refunds.length})
              </button>
              {isRefundOpen && (
                <div className="mt-3 text-xs text-zinc-500">
                  <p>
                    Pergerakan uang pada sesi kas ini. Nominalnya sudah masuk
                    dalam perhitungan kas seharusnya.
                  </p>
                  {refunds.length === 0 ? (
                    <p className="mt-3">
                      Belum ada refund tunai yang tercatat pada sesi kas ini.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                      {refunds.map((refund, index) => (
                        <li
                          key={`${refund.receipt_no}-${index}`}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <span>
                            <span className="font-mono text-zinc-700 dark:text-zinc-300">
                              {refund.receipt_no}
                            </span>
                            <span className="ml-2 text-zinc-400">
                              {formatDateTime(refund.created_at)}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                            {formatRupiah(refund.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {detailError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {detailError}
            </div>
          )}
        </div>

        <div className="self-start rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="mb-2 text-sm font-semibold">Rincian uang laci</h4>
          {isOpen ? (
            <>
              {moneyRow("Modal awal", formatRupiah(shift.opening_cash))}
              {moneyRow("Kas masuk lainnya", openTotals ? formatRupiah(openTotals.cashIn) : "-")}
              {moneyRow("Kas keluar lainnya", openTotals ? formatRupiah(openTotals.cashOut) : "-")}
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                Penjualan tunai, kas seharusnya, dan selisih tampil setelah
                sesi ditutup. Hitung uang fisik di laci lebih dulu.
              </p>
            </>
          ) : !detail ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
              {detailError ? (
                "-"
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Memuat rincian...
                </>
              )}
            </div>
          ) : (
            <>
              {moneyRow("Modal awal", formatRupiah(detail.opening_cash))}
              {moneyRow("Penjualan & penerimaan tunai", formatRupiah(detail.cash_sales))}
              {moneyRow("Refund retur", formatRupiah(detail.cash_refunds))}
              {moneyRow("Kas masuk lainnya", formatRupiah(detail.cash_in))}
              {moneyRow("Kas keluar lainnya", formatRupiah(detail.cash_out))}
              {moneyRow("Kas seharusnya", formatRupiah(detail.expected_cash), true)}
              {moneyRow("Kas fisik dihitung", formatRupiah(detail.actual_cash))}
              <div className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-zinc-500">Selisih akhir</span>
                <span
                  className={`font-mono font-medium tabular-nums ${differenceColorClass(detail.difference)}`}
                >
                  {differenceLabel(detail.difference)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                Kas seharusnya dihitung dari modal awal, penjualan tunai, kas
                masuk dan keluar, serta refund retur. Cocokkan dengan uang fisik
                di laci.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Button type="button" onClick={onClose} variant="secondary" size="md">
          Tutup
        </Button>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

type HistoryTab = "all" | "open" | "closed";

interface KasModuleProps {
  /** Pindah ke layar Kasir (sesi yang sedang berjalan dilanjutkan di sana). */
  onOpenKasir?: () => void;
}

export default function KasModule({ onOpenKasir }: KasModuleProps = {}) {
  const {
    activeShift,
    history,
    isLoading,
    error,
    refetch,
    closeShift,
    getSessionNumber,
  } = useShifts();
  const {
    movements,
    summary,
    isLoading: isMovementsLoading,
    error: movementsError,
    addMovement,
    voidMovement,
    refetch: refetchMovements,
  } = useCashMovements(activeShift?.id ?? null);
  const { user } = useAuth();
  const { settings: posSettings, outlet } = useSettings();
  const { printReceipt } = usePrinterProfiles();
  const { branches, activeBranchId } = useActiveBranch();
  const printCloseReceipt = useShiftCloseReceipt({
    posSettings,
    outlet,
    user,
    printReceipt,
  });

  // Riwayat = sesi berjalan (kalau ada) + sesi yang sudah ditutup.
  const allShifts = useMemo(
    () => (activeShift ? [activeShift, ...history] : history),
    [activeShift, history],
  );
  const cashTotalsByShift = useCashTotalsByShift(allShifts.map((s) => s.id));
  // Penjualan tunai per sesi yang sudah ditutup (kolom di riwayat).
  const closedSales = useClosedCashSales(
    history.map((s) => s.id),
  );

  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<CashMovement | null>(null);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseShiftResult | null>(null);
  const [detailShift, setDetailShift] = useState<ShiftSession | null>(null);
  const [tab, setTab] = useState<HistoryTab>("all");
  const [query, setQuery] = useState("");
  // Filter outlet riwayat. null = ikut cabang aktif di Header; "" = semua outlet
  // (hanya ditawarkan ke user yang boleh mengakses lebih dari satu cabang).
  const [branchFilterChoice, setBranchFilterChoice] = useState<string | null>(null);

  // Durasi sesi berjalan diperbarui tiap 30 detik.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const activeBranches = branches.filter((b) => b.is_active);
  const canPickAllBranches = activeBranches.length > 1;
  const branchFilter =
    branchFilterChoice ?? (canPickAllBranches ? (activeBranchId ?? "") : (activeBranches[0]?.id ?? ""));

  const cashierName = user?.full_name ?? user?.email ?? "Kasir";
  const branchName = (branchId: string | null) =>
    branches.find((b) => b.id === branchId)?.name ?? "—";

  const handleClose = async (actualCash: number, notes?: string) => {
    const openedAt = activeShift?.opened_at ?? null;
    const result = await closeShift(actualCash, notes);
    printCloseReceipt(result, openedAt);
    setCloseResult(result);
    setIsCloseModalOpen(false);
  };

  const handleReload = () => {
    refetch();
    refetchMovements();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allShifts.filter((shift) => {
      if (tab === "open" && shift.status !== "OPEN") return false;
      if (tab === "closed" && shift.status !== "CLOSED") return false;
      // Sesi lama tanpa cabang (null) tetap ditampilkan.
      if (branchFilter && shift.branch_id && shift.branch_id !== branchFilter) return false;
      if (!q) return true;
      const haystack = [
        cashierName,
        branchName(shift.branch_id),
        `#${getSessionNumber(shift.id) ?? ""}`,
        formatLongDate(shift.opened_at),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allShifts, tab, query, branchFilter, cashierName, branches, getSessionNumber]);

  const groups = useMemo(() => {
    const today = new Date();
    const map = new Map<string, { label: string; items: ShiftSession[] }>();
    for (const shift of filtered) {
      const d = new Date(shift.opened_at);
      const key = d.toDateString();
      if (!map.has(key)) {
        map.set(key, {
          label: isSameDay(d, today) ? "Hari ini" : formatLongDate(shift.opened_at),
          items: [],
        });
      }
      map.get(key)!.items.push(shift);
    }
    return Array.from(map.values());
  }, [filtered]);

  const activeNumber = activeShift ? getSessionNumber(activeShift.id) : null;

  return (
    <div className="h-full flex flex-col gap-6 bg-zinc-100 dark:bg-zinc-950 p-4 md:p-6 text-zinc-900 dark:text-zinc-100 overflow-y-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Sesi Kasir & Kas</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Pantau uang laci, lalu cocokkan kas saat selesai bertugas.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleReload}
          variant="secondary"
          size="sm"
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Muat ulang
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat status sesi...
        </div>
      ) : activeShift ? (
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid md:grid-cols-[1fr_320px]">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Sesi kas Anda{" "}
                  {activeNumber && (
                    <span className="text-[11px] font-normal text-zinc-400">#{activeNumber}</span>
                  )}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-lco-teal/10 px-2 py-0.5 text-[10px] font-semibold text-lco-teal">
                  <span className="h-1.5 w-1.5 rounded-full bg-lco-teal" />
                  Berjalan
                </span>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  <UserIcon className="h-5 w-5 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{cashierName}</p>
                  <p className="flex items-center gap-1 text-xs text-zinc-500">
                    <Store className="h-3 w-3" />
                    {branchName(activeShift.branch_id)}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 text-xs dark:border-zinc-900">
                <div>
                  <p className="text-zinc-500">Kas dibuka</p>
                  <p className="mt-1 text-sm font-medium">{formatDateTime(activeShift.opened_at)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Durasi sesi kas</p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-medium">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(activeShift.opened_at, null, nowMs)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
                {onOpenKasir && (
                  <Button type="button" onClick={onOpenKasir} variant="primary" size="md">
                    Lanjut ke kasir
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
                <Button type="button" onClick={() => setIsCashModalOpen(true)} variant="secondary" size="md">
                  <Wallet className="h-4 w-4" />
                  Tarik / setor kas
                </Button>
                <Button type="button" onClick={() => setIsCloseModalOpen(true)} variant="secondary" size="md">
                  <Lock className="h-4 w-4" />
                  Tutup Sesi Kas
                </Button>
              </div>
            </div>

            {/* Panel kanan: hanya angka yang kasir tahu sendiri. Kas seharusnya,
                penjualan tunai, dan refund SENGAJA tidak ditampilkan. */}
            <aside className="border-t border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40 md:border-l md:border-t-0">
              <p className="text-xs text-zinc-500">Modal awal laci</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatRupiah(activeShift.opening_cash)}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Kas seharusnya tampil setelah sesi ditutup. Hitung uang fisik di
                laci lebih dulu, lalu sistem yang mencocokkan.
              </p>
              <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Kas masuk lainnya</span>
                  <span className="font-mono tabular-nums">{formatRupiah(summary.cashIn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Kas keluar lainnya</span>
                  <span className="font-mono tabular-nums">{formatRupiah(summary.cashOut)}</span>
                </div>
              </div>
            </aside>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <Wallet className="h-5 w-5 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Belum ada sesi kas terbuka</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Sesi dimulai dari tombol Buka Kasir: hitung uang di laci sebagai
                modal awal, lalu mulai bertransaksi.
              </p>
            </div>
          </div>
        </section>
      )}

      {activeShift && !isLoading && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Kas Masuk/Keluar Sesi Ini
          </h3>

          {movementsError && (
            <div className="mb-3 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {movementsError}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {isMovementsLoading && movements.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat catatan kas...
              </div>
            ) : movements.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Belum ada kas masuk/keluar di sesi ini.
              </p>
            ) : (
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    {["Waktu", "Jenis", "Kategori", "Keterangan", "Nominal", ""].map((label, index) => (
                      <th key={index} className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {movements.map((movement) => {
                    const isVoided = Boolean(movement.voided_at);
                    return (
                      <tr key={movement.id} className={isVoided ? "opacity-60" : ""}>
                        <td className="px-5 py-3 font-mono text-xs tabular-nums">
                          {formatDateTime(movement.created_at)}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              movement.type === "IN"
                                ? "bg-lco-teal/10 text-lco-teal"
                                : "bg-lco-coral/10 text-lco-coral"
                            }`}
                          >
                            {movement.type === "IN" ? (
                              <ArrowDownLeft className="h-3 w-3" />
                            ) : (
                              <ArrowUpRight className="h-3 w-3" />
                            )}
                            {movement.type === "IN" ? "Masuk" : "Keluar"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs">{categoryLabel(movement.category)}</td>
                        <td className="max-w-xs whitespace-normal px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                          {movement.note}
                          {isVoided && (
                            <span className="mt-0.5 block text-[11px] text-zinc-400">
                              Dibatalkan: {movement.void_reason}
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-5 py-3 font-mono text-xs font-medium tabular-nums ${
                            isVoided ? "line-through" : ""
                          }`}
                        >
                          {formatRupiah(movement.amount)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {!isVoided && (
                            <Button type="button" onClick={() => setVoidTarget(movement)} variant="secondary" size="sm">
                              Batalkan
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* ── Riwayat sesi kas ── */}
      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Riwayat sesi kas</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {filtered.length} sesi terbaru di outlet yang dipilih.
            </p>
          </div>
          <div className="relative md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kasir, nomor, atau tanggal..."
              aria-label="Cari riwayat sesi kas"
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <TabSwitcher<HistoryTab>
            size="sm"
            ariaLabel="Filter status sesi kas"
            tabs={[
              { key: "all", label: "Semua" },
              { key: "open", label: "Berjalan" },
              { key: "closed", label: "Selesai" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Outlet
            <Select
              size="sm"
              value={branchFilter}
              onChange={(e) => setBranchFilterChoice(e.target.value)}
              className="max-w-52"
              aria-label="Filter outlet riwayat sesi kas"
            >
              {canPickAllBranches && <option value="">Semua outlet</option>}
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {groups.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center border-t border-zinc-100 px-6 text-center dark:border-zinc-900">
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <Inbox className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold">Belum ada riwayat sesi</h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Sesi kas yang dibuka lewat Buka Kasir akan muncul di sini.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="flex items-center justify-between border-y border-zinc-100 bg-zinc-50 px-5 py-2 text-[11px] font-semibold text-zinc-600 dark:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  {group.label}
                </span>
                <span className="font-normal text-zinc-400">{group.items.length} sesi</span>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {group.items.map((shift) => {
                  const isOpen = shift.status === "OPEN";
                  const number = getSessionNumber(shift.id);
                  const totals = cashTotalsByShift[shift.id];
                  return (
                    <li
                      key={shift.id}
                      className={`grid items-center gap-3 px-5 py-4 md:grid-cols-[90px_1fr_repeat(4,110px)_auto] ${
                        isOpen ? "border-l-2 border-l-lco-teal bg-lco-teal/5" : ""
                      }`}
                    >
                      <div className="text-xs">
                        <p className="font-mono font-semibold tabular-nums">{formatClock(shift.opened_at)}</p>
                        <p className="text-[10px] text-zinc-400">Kas dibuka</p>
                      </div>
                      <div className="min-w-0 text-xs">
                        <p className="flex items-center gap-2 font-semibold">
                          <span className="truncate">{cashierName}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              isOpen ? "bg-lco-teal/10 text-lco-teal" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"
                            }`}
                          >
                            {isOpen ? "Berjalan" : "Selesai"}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {number ? `#${number} · ` : ""}
                          {branchName(shift.branch_id)}
                        </p>
                        {shift.closed_at && (
                          <p className="text-[10px] text-zinc-400">Ditutup {formatDateTime(shift.closed_at)}</p>
                        )}
                      </div>
                      <div className="text-xs md:text-right">
                        <p className="text-[10px] text-zinc-400">Modal awal</p>
                        <p className="font-mono tabular-nums">{formatRupiah(shift.opening_cash)}</p>
                      </div>
                      <div className="text-xs md:text-right">
                        <p className="text-[10px] text-zinc-400">Penjualan tunai</p>
                        <p className="font-mono tabular-nums">
                          {isOpen || closedSales[shift.id] === undefined
                            ? "-"
                            : formatRupiah(closedSales[shift.id])}
                        </p>
                      </div>
                      <div className="text-xs md:text-right">
                        <p className="text-[10px] text-zinc-400">Selisih kas</p>
                        {isOpen ? (
                          <p className="font-medium text-lco-mustard">Belum ditutup</p>
                        ) : (
                          <p className={`font-mono font-medium tabular-nums ${differenceColorClass(shift.difference)}`}>
                            {differenceLabel(shift.difference)}
                          </p>
                        )}
                      </div>
                      <div className="text-xs md:text-right">
                        <p className="text-[10px] text-zinc-400">Durasi</p>
                        <p className="tabular-nums">{formatDuration(shift.opened_at, shift.closed_at, nowMs)}</p>
                      </div>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setDetailShift(shift)}>
                        Lihat detail
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {isCashModalOpen && (
        <CashMovementModal onClose={() => setIsCashModalOpen(false)} onSubmit={addMovement} />
      )}
      {isCloseModalOpen && (
        <CloseShiftModal
          onClose={() => setIsCloseModalOpen(false)}
          onSubmit={handleClose}
          cashMovementSummary={summary}
        />
      )}
      {closeResult && (
        <CloseShiftSummaryModal result={closeResult} onDone={() => setCloseResult(null)} />
      )}
      {detailShift && (
        <ShiftDetailModal
          shift={detailShift}
          number={getSessionNumber(detailShift.id)}
          branchName={branchName(detailShift.branch_id)}
          cashierName={cashierName}
          openTotals={cashTotalsByShift[detailShift.id]}
          nowMs={nowMs}
          onClose={() => setDetailShift(null)}
        />
      )}
      {voidTarget && (
        <VoidCashMovementModal
          movement={voidTarget}
          onClose={() => setVoidTarget(null)}
          onConfirm={async (reason) => {
            await voidMovement(voidTarget.id, reason);
            setVoidTarget(null);
          }}
        />
      )}
    </div>
  );
}
