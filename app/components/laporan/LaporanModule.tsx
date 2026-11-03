"use client";

// app/components/laporan/LaporanModule.tsx
// ── TAMBAHAN (T-08) ── Modul Laporan (PRD §17 Fase E, §4.5, §4.7).
// Konsumen hooks/useReports.ts (data 3 sub-tab).
// ── TAMBAHAN (adopsi dari Laporan Harian Kula POS) ── Tab Harian/Bulanan juga
// memakai hooks/useSalesInsights.ts + HarianInsights.tsx: selisih persen KPI
// terhadap periode sebelumnya, bauran metode bayar, produk terlaris, dan kas
// keluar per kategori.
//
// Akses: **diasumsikan admin/supervisor saja** (sama seperti StokModule.tsx),
// BUKAN dikutip langsung dari teks PRD — lihat catatan ASUMSI di header
// hooks/useReports.ts. Kalau ternyata salah, tinggal ubah `canViewReports` di
// bawah, tidak perlu ubah hook.
//
// Pola UI sengaja disamakan dengan KasModule.tsx/StokModule.tsx (kartu status,
// tabel, modal, warna lco-teal/lco-coral/lco-mustard) supaya tidak ada dialek
// visual baru di codebase ini.
//
// Yang SENGAJA belum ada di sini (bukan bug, scope file terpisah):
// - `generateReceiptImage()` untuk share WA (disebut di rencana T-08 awal) —
//   itu bagian printLogic.ts, file terpisah (menyusul).
// - Penyembunyian MENU Laporan dari Sidebar untuk kasir — itu di Sidebar.tsx +
//   page.tsx (file terpisah), belum diubah di sini. Untuk sekarang kalau
//   kasir buka menu ini, yang menahan cuma layar blokir di bawah, sama
//   seperti pola StokModule.tsx sebelum T-10.
//
// ── REVISI (rentang tanggal per tab) ── Tidak ada lagi filter tanggal global.
// Tab Harian/Bulanan, Jam & Hari Ramai, Retur, dan Per Shift masing-masing
// punya filter rentang sendiri (DateRangeFilter.tsx) di dalam tab-nya, dengan
// state terpisah dari hooks/useReportDateRange.ts. Tab Piutang/Tempo memang
// tidak memakai rentang (lihat catatan #2 di hooks/useReports.ts).
// Bar tab memakai gaya "segmented control" yang sama dengan Stok & Pengaturan.
//
// Export Excel/PDF (lib/pos/reportExport.ts) SUDAH tersambung di sini lewat
// dropdown "Export" — lihat `handleExportExcel`/`handleExportPdf` di
// komponen utama. `reportContentRef` sengaja hanya membungkus konten TAB
// AKTIF (bukan seluruh halaman) supaya PDF-nya cuma berisi data laporan,
// tidak ikut menangkap filter tanggal/tombol tab.

import { useMemo, useRef, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  Inbox,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  CheckCircle2,
  Clock,
  X,
  Download,
  ChevronDown,
  Activity,
  RotateCcw,
} from "lucide-react";
import {
  useReports,
  type ReceivableRow,
  type ReceivableStatus,
} from "@/hooks/useReports";
import { useReportDateRange } from "@/hooks/useReportDateRange";
import { useAuth, hasPermission } from "@/hooks/useAuth";
import { formatRupiah } from "@/lib/pos/cartLogic";
import { exportReportToExcel, exportReportToPdf } from "@/lib/pos/reportExport";
import {
  useSalesInsights,
  type UseSalesInsightsResult,
} from "@/hooks/useSalesInsights";
import { useHourlyTraffic } from "@/hooks/useHourlyTraffic";
import { useReturnsReport } from "@/hooks/useReturnsReport";
import { TrafficTab } from "@/app/components/laporan/TrafficTab";
import { ReturnsTab } from "@/app/components/laporan/ReturnsTab";
import {
  DateRangeFilter,
  formatRangeLabel,
} from "@/app/components/laporan/DateRangeFilter";
import {
  ComparisonCaption,
  DeltaBadge,
  HarianInsightsSection,
} from "@/app/components/laporan/HarianInsights";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";

// Piutang tidak memakai rentang tanggal; label ini dipakai di judul PDF & Excel.
const PIUTANG_RANGE_LABEL =
  "Semua piutang belum lunas + yang lunas 30 hari terakhir";

type ReportTab = "harian" | "ramai" | "retur" | "shift" | "piutang";

const TABS: { key: ReportTab; label: string; icon: typeof TrendingUp }[] = [
  { key: "harian", label: "Harian/Bulanan", icon: TrendingUp },
  { key: "ramai", label: "Jam & Hari Ramai", icon: Activity },
  { key: "retur", label: "Retur", icon: RotateCcw },
  { key: "shift", label: "Per Shift", icon: Users },
  { key: "piutang", label: "Piutang/Tempo", icon: Wallet },
];

// ── Util tampilan ────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

function formatDateOnly(value: string | null): string {
  if (!value) return "-";
  // `value` dari kolom `date` Postgres ("YYYY-MM-DD") — parse manual komponennya,
  // JANGAN `new Date(value)` langsung (itu diparse sebagai UTC tengah malam,
  // bisa mundur 1 hari saat ditampilkan di WIB). Pola sama seperti catatan
  // waktu lokal di useDashboard.ts/useReports.ts.
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

function differenceColorClass(difference: number | null): string {
  if (difference === null) return "text-zinc-400";
  if (difference === 0) return "text-lco-teal";
  if (difference < 0) return "text-lco-coral";
  return "text-lco-mustard";
}

function differenceLabel(difference: number | null): string {
  if (difference === null) return "-";
  if (difference === 0) return `Pas — ${formatRupiah(0)}`;
  if (difference < 0) return `Kurang ${formatRupiah(Math.abs(difference))}`;
  return `Lebih ${formatRupiah(difference)}`;
}

const RECEIVABLE_BADGE: Record<
  ReceivableStatus,
  { label: string; className: string }
> = {
  LUNAS: {
    label: "Lunas",
    className: "bg-lco-teal/10 text-lco-teal border-lco-teal/30",
  },
  JATUH_TEMPO: {
    label: "Jatuh Tempo",
    className: "bg-lco-coral/10 text-lco-coral border-lco-coral/30",
  },
  BELUM_LUNAS: {
    label: "Belum Lunas",
    className:
      "bg-lco-mustard/20 text-zinc-700 dark:text-lco-mustard border-lco-mustard/40",
  },
};

// --------------------------------------------------------
// Modal: Tandai Lunas
// --------------------------------------------------------

function SettleReceivableModal({
  receivable,
  onClose,
  onSettle,
}: {
  receivable: ReceivableRow;
  onClose: () => void;
  onSettle: (paymentId: string) => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onSettle(receivable.payment_id);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menandai lunas.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal size="sm" layout="plain">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <CheckCircle2 className="h-4 w-4 text-lco-teal" />
          Tandai Lunas
        </h3>
        <IconButton
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          size="sm"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      {done ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-lco-teal/30 bg-lco-teal/10 p-3 text-xs text-lco-teal">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Piutang {receivable.receipt_no} berhasil ditandai lunas.
          </div>
          <Button
            type="button"
            onClick={onClose}
            size="lg"
            fullWidth
          >
            Selesai
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4 space-y-1 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            <div className="flex justify-between">
              <span className="text-zinc-500">Struk</span>
              <span className="font-mono">{receivable.receipt_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Pelanggan</span>
              <span>{receivable.customer_name ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Nominal</span>
              <span className="font-mono tabular-nums font-semibold">
                {formatRupiah(receivable.amount)}
              </span>
            </div>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            size="lg"
            fullWidth
            className="mt-5"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Tandai Lunas
          </Button>
        </>
      )}
    </Modal>
  );
}

// --------------------------------------------------------
// Sub-tab: Harian/Bulanan
// --------------------------------------------------------

function HarianBulananTab({
  summary,
  daily,
  insights,
}: {
  summary: ReturnType<typeof useReports>["salesSummary"];
  daily: ReturnType<typeof useReports>["dailySales"];
  insights: UseSalesInsightsResult;
}) {
  // Selisih KPI dibandingkan periode sebelumnya (hanya kalau datanya sudah ada).
  const comparison = insights.data
    ? {
        current: insights.data.currentSummary,
        previous: insights.data.previousSummary,
      }
    : null;

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Omzet
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {formatRupiah(summary.revenue)}
          </p>
          {comparison && (
            <DeltaBadge
              current={comparison.current.revenue}
              previous={comparison.previous.revenue}
            />
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Transaksi
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {summary.transactionCount}
          </p>
          {comparison && (
            <DeltaBadge
              current={comparison.current.transactionCount}
              previous={comparison.previous.transactionCount}
            />
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Item Terjual
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {summary.itemsSold}
          </p>
          {comparison && (
            <DeltaBadge
              current={comparison.current.itemsSold}
              previous={comparison.previous.itemsSold}
            />
          )}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Rata-rata/Transaksi
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {formatRupiah(summary.averageTicket)}
          </p>
          {comparison && (
            <DeltaBadge
              current={comparison.current.averageTicket}
              previous={comparison.previous.averageTicket}
            />
          )}
        </div>
      </div>

      {insights.data && <ComparisonCaption data={insights.data} />}

      <HarianInsightsSection insights={insights} />

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-200">
                Tanggal
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-200">
                Omzet
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-200">
                Transaksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {daily.map((point) => (
              <tr key={point.date}>
                <td className="px-5 py-2.5 text-xs">{point.label}</td>
                <td
                  className={`px-5 py-2.5 font-mono text-xs tabular-nums ${
                    point.revenue < 0 ? "text-lco-coral" : ""
                  }`}
                >
                  {formatRupiah(point.revenue)}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs tabular-nums">
                  {point.transactionCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------
// Sub-tab: Per Shift
// --------------------------------------------------------

function PerShiftTab({
  shifts,
}: {
  shifts: ReturnType<typeof useReports>["shifts"];
}) {
  if (shifts.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-zinc-200 px-6 text-center dark:border-zinc-800">
        <Inbox className="mb-2 h-6 w-6 text-zinc-400" />
        <p className="text-sm text-zinc-500">
          Tidak ada shift pada rentang tanggal ini.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Kasir
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Dibuka
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Ditutup
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Status
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Modal Awal
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Kas Masuk
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Kas Keluar
            </th>
            <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Selisih
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {shifts.map((shift) => (
            <tr key={shift.id}>
              <td className="px-5 py-3 text-xs font-medium">
                {shift.cashier_name ?? "-"}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {formatDateTime(shift.opened_at)}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {shift.closed_at ? formatDateTime(shift.closed_at) : "-"}
              </td>
              <td className="px-5 py-3 text-xs">
                {shift.status === "OPEN" ? (
                  <span className="rounded-full border border-lco-mustard/40 bg-lco-mustard/20 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:text-lco-mustard">
                    Belum Ditutup
                  </span>
                ) : (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                    Selesai
                  </span>
                )}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {formatRupiah(shift.opening_cash)}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {shift.cash_in === null ? "-" : formatRupiah(shift.cash_in)}
              </td>
              <td className="px-5 py-3 font-mono text-xs tabular-nums">
                {shift.cash_out === null ? "-" : formatRupiah(shift.cash_out)}
              </td>
              <td
                className={`px-5 py-3 font-mono text-xs font-medium tabular-nums ${differenceColorClass(shift.difference)}`}
              >
                {differenceLabel(shift.difference)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------
// Sub-tab: Piutang/Tempo
// --------------------------------------------------------

function PiutangTab({
  receivables,
  onSettle,
}: {
  receivables: ReceivableRow[];
  onSettle: (paymentId: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<ReceivableRow | null>(null);

  if (receivables.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-zinc-200 px-6 text-center dark:border-zinc-800">
        <Inbox className="mb-2 h-6 w-6 text-zinc-400" />
        <p className="text-sm text-zinc-500">
          Tidak ada piutang — baik yang belum lunas maupun yang lunas 30 hari
          terakhir.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Struk
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Pelanggan
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Jatuh Tempo
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Nominal
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Status
              </th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {receivables.map((row) => {
              const badge = RECEIVABLE_BADGE[row.status];
              return (
                <tr key={row.payment_id}>
                  <td className="px-5 py-3 font-mono text-xs">
                    {row.receipt_no}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {row.customer_name ?? "-"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs tabular-nums">
                    {formatDateOnly(row.due_date)}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums">
                    {formatRupiah(row.amount)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!row.is_settled && (
                      <Button
                        type="button"
                        onClick={() => setTarget(row)}
                        size="sm"
                      >
                        Tandai Lunas
                      </Button>
                    )}
                    {row.is_settled && row.settled_at && (
                      <span className="flex items-center justify-end gap-1 text-[11px] text-zinc-400">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(row.settled_at)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {target && (
        <SettleReceivableModal
          receivable={target}
          onClose={() => setTarget(null)}
          onSettle={onSettle}
        />
      )}
    </>
  );
}

// --------------------------------------------------------
// Modul utama
// --------------------------------------------------------

export default function LaporanModule() {
  const { user, isLoading: isAuthLoading } = useAuth();

  // ── REVISI ── Satu rentang tanggal PER TAB. State hidup di sini (bukan di
  // komponen tab) supaya pilihan tiap tab tidak hilang saat pindah tab.
  const harianRange = useReportDateRange("this_month");
  const ramaiRange = useReportDateRange("this_month");
  const returRange = useReportDateRange("this_month");
  const shiftRange = useReportDateRange("this_month");

  const {
    salesSummary,
    dailySales,
    isSalesLoading,
    salesError,
    shifts,
    isShiftsLoading,
    shiftsError,
    receivables,
    isReceivablesLoading,
    receivablesError,
    settleReceivable,
  } = useReports({
    salesRange: harianRange.dateRange,
    shiftRange: shiftRange.dateRange,
  });

  // ── TAMBAHAN ── Wawasan penjualan untuk tab Harian/Bulanan (rentang tab
  // Harian). Hanya dimuat untuk user yang punya izin "laporan" (RLS tetap
  // penjaga utamanya).
  const insights = useSalesInsights(harianRange.dateRange, {
    enabled: hasPermission(user, "laporan"),
  });

  const [activeTab, setActiveTab] = useState<ReportTab>("harian");

  // ── TAMBAHAN ── Data tab Jam & Hari Ramai dan Retur: baru diambil saat
  // tabnya dibuka, dan hanya untuk user yang punya izin "laporan".
  const canLoadReports = hasPermission(user, "laporan");
  const traffic = useHourlyTraffic(ramaiRange.dateRange, {
    enabled: canLoadReports && activeTab === "ramai",
  });
  const returnsReport = useReturnsReport(returRange.dateRange, {
    enabled: canLoadReports && activeTab === "retur",
  });

  // ── TAMBAHAN (T-08 lanjutan) ── State & ref untuk export Excel/PDF.
  // `reportContentRef` sengaja ditaruh cuma di sekeliling KONTEN TAB AKTIF
  // (bukan filter tanggal/tombol tab) — supaya PDF yang dihasilkan cuma
  // berisi data laporan. Lihat lib/pos/reportExport.ts untuk kenapa Excel &
  // PDF punya sumber data yang beda (data mentah vs snapshot visual DOM).
  const reportContentRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Rentang tiap tab sebagai label — format sama dengan yang tampil di
  // DateRangeFilter, supaya isi file Excel/PDF mudah dicocokkan dengan layar.
  const harianRangeLabel = formatRangeLabel(harianRange.dateRange);
  const shiftRangeLabel = formatRangeLabel(shiftRange.dateRange);
  const activeRangeLabel =
    activeTab === "harian"
      ? harianRangeLabel
      : activeTab === "ramai"
        ? formatRangeLabel(ramaiRange.dateRange)
        : activeTab === "retur"
          ? formatRangeLabel(returRange.dateRange)
          : activeTab === "shift"
            ? shiftRangeLabel
            : PIUTANG_RANGE_LABEL;

  const handleExportExcel = () => {
    setIsExportMenuOpen(false);
    setExportError(null);
    try {
      exportReportToExcel({
        salesRangeLabel: harianRangeLabel,
        shiftRangeLabel,
        receivablesRangeLabel: PIUTANG_RANGE_LABEL,
        summary: salesSummary,
        daily: dailySales,
        shifts,
        receivables,
      });
    } catch (err) {
      // `XLSX.writeFile` jarang gagal (murni proses client), tapi tetap
      // dibungkus try/catch — mis. browser yang memblokir download otomatis.
      setExportError(
        err instanceof Error ? err.message : "Gagal membuat file Excel.",
      );
    }
  };

  const handleExportPdf = async () => {
    setIsExportMenuOpen(false);
    setExportError(null);

    if (!reportContentRef.current) {
      // Secara teori tidak akan kejadian (tombol Export selalu ada bareng
      // konten tab), tapi dijaga eksplisit — daripada exportReportToPdf()
      // dipanggil dengan null dan error-nya jadi TypeError yang membingungkan.
      setExportError("Konten laporan belum siap untuk diekspor.");
      return;
    }

    setIsExporting(true);
    try {
      const tabLabel =
        TABS.find((tab) => tab.key === activeTab)?.label ?? "Laporan";
      await exportReportToPdf(reportContentRef.current, {
        title: `Laporan ${tabLabel}`,
        dateRangeLabel: activeRangeLabel,
      });
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Gagal membuat file PDF.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  // ── REVISI (migration 028/030) ── `user?.role` (string admin/supervisor)
  // sudah dihapus, diganti permission dinamis "laporan". Lihat juga catatan
  // ASUMSI di header file & hooks/useReports.ts.
  const canViewReports = hasPermission(user, "laporan");

  const receivablesUnsettledCount = useMemo(
    () => receivables.filter((r) => !r.is_settled).length,
    [receivables],
  );

  if (!isAuthLoading && !canViewReports) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Modul Laporan hanya untuk supervisor dan admin. Hubungi admin kalau
          Anda memang perlu melihat laporan ini.
        </p>
      </div>
    );
  }

  // Rentang, loading, dan error milik tab yang sedang aktif. `null` berarti
  // tab itu tidak punya filter tanggal (Piutang) atau mengurus loading/error-nya
  // sendiri (Jam & Hari Ramai, Retur — lihat TrafficTab/ReturnsTab).
  const activeRange =
    activeTab === "harian"
      ? harianRange
      : activeTab === "ramai"
        ? ramaiRange
        : activeTab === "retur"
          ? returRange
          : activeTab === "shift"
            ? shiftRange
            : null;

  const activeLoading =
    activeTab === "harian"
      ? isSalesLoading
      : activeTab === "shift"
        ? isShiftsLoading
        : activeTab === "piutang"
          ? isReceivablesLoading
          : false;

  const activeError =
    activeTab === "harian"
      ? salesError
      : activeTab === "shift"
        ? shiftsError
        : activeTab === "piutang"
          ? receivablesError
          : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Laporan
          </p>
          <h2 className="text-xl font-semibold tracking-tight">Laporan</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Omzet, jam ramai, retur, riwayat shift, dan piutang tempo — tiap
            tab punya rentang tanggalnya sendiri.
          </p>
        </div>

        {/* Export Excel/PDF (T-08 lanjutan) — dropdown, bukan tombol tunggal,
            karena dua format ini sumber datanya beda (lihat catatan di
            lib/pos/reportExport.ts): Excel = data mentah Harian, Per Shift &
            Piutang sekaligus (tiap sheet memakai rentang tab-nya), PDF =
            snapshot visual tab yang SEDANG aktif saja. */}
        <div className="relative">
          <Button
            type="button"
            onClick={() => setIsExportMenuOpen((open) => !open)}
            disabled={isExporting}
            variant="secondary"
            size="sm"
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Export
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-150 ${
                isExportMenuOpen ? "rotate-180" : ""
              }`}
            />
          </Button>

          {isExportMenuOpen && (
            <div className="absolute right-0 z-10 mt-2 w-60 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
              <button
                type="button"
                onClick={handleExportExcel}
                className="block w-full px-4 py-2.5 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Excel (.xlsx) — Harian, Shift &amp; Piutang
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="block w-full border-t border-zinc-100 px-4 py-2.5 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                PDF — tab &quot;
                {TABS.find((tab) => tab.key === activeTab)?.label}&quot; ini
              </button>
            </div>
          )}
        </div>
      </div>

      {exportError && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {exportError}
        </div>
      )}

      {/* Tab switcher — gaya "segmented control" yang sama dengan menu Stok &
          Pengaturan: kontainer beruas, tab aktif dapat latar putih + shadow. */}
      <div className="mb-4 inline-flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 ${
              activeTab === key
                ? "bg-white text-lco-green shadow-sm dark:bg-zinc-800 dark:text-lco-teal"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {key === "piutang" && receivablesUnsettledCount > 0 && (
              <span className="rounded-full bg-lco-coral px-1.5 text-[10px] font-bold text-white">
                {receivablesUnsettledCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter rentang waktu — milik tab yang sedang aktif. Piutang tidak
          punya rentang, jadi diganti catatan singkat. Filter sengaja di luar
          `reportContentRef` supaya tidak ikut ter-snapshot ke PDF. */}
      {activeRange ? (
        <DateRangeFilter
          preset={activeRange.preset}
          dateRange={activeRange.dateRange}
          onChange={activeRange.setPreset}
        />
      ) : (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Piutang tidak mengikuti rentang tanggal: yang ditampilkan semua
          piutang belum lunas, ditambah yang lunas dalam 30 hari terakhir.
        </p>
      )}

      {activeError && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {activeError}
        </div>
      )}

      {activeLoading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat data laporan...
        </div>
      ) : (
        !activeError && (
          <div ref={reportContentRef} className="p-1">
            {activeTab === "harian" && (
              <HarianBulananTab
                summary={salesSummary}
                daily={dailySales}
                insights={insights}
              />
            )}
            {activeTab === "ramai" && <TrafficTab traffic={traffic} />}
            {activeTab === "retur" && <ReturnsTab returns={returnsReport} />}
            {activeTab === "shift" && <PerShiftTab shifts={shifts} />}
            {activeTab === "piutang" && (
              <PiutangTab receivables={receivables} onSettle={settleReceivable} />
            )}
          </div>
        )
      )}
    </div>
  );
}
