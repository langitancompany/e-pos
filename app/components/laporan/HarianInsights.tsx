"use client";

// app/components/laporan/HarianInsights.tsx
// ── TAMBAHAN (Laporan, adopsi ide dari "Laporan Harian" Kula POS) ──────────
// Bagian tambahan tab Harian/Bulanan: selisih persen di kartu KPI (DeltaBadge),
// keterangan periode pembanding (ComparisonCaption), serta tiga kartu — bauran
// metode pembayaran, produk terlaris, dan kas keluar per kategori
// (HarianInsightsSection). Data dari hooks/useSalesInsights.ts.
//
// Pola visual disamakan dengan LaporanModule.tsx (kartu rounded-xl, warna
// lco-teal/lco-coral, icon lucide) — tidak ada gaya baru.
//
// Komponen ini ikut tertangkap saat export PDF tab Harian (snapshot DOM).
// Export Excel belum memuat bagian ini (itu dari data mentah useReports.ts).

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Inbox,
  Loader2,
  Minus,
  Package,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import { deltaPercent } from "@/lib/pos/reportInsights";
import type {
  SalesInsightsData,
  UseSalesInsightsResult,
} from "@/hooks/useSalesInsights";

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

// --------------------------------------------------------
// Selisih persen di kartu KPI
// --------------------------------------------------------

export function DeltaBadge({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const percent = deltaPercent(current, previous);

  if (percent === null) {
    return (
      <p className="mt-1 text-[11px] text-zinc-400">
        Periode sebelumnya kosong
      </p>
    );
  }

  const rounded = Math.round(percent * 10) / 10;

  if (rounded === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400">
        <Minus className="h-3 w-3" />
        Sama dengan periode sebelumnya
      </p>
    );
  }

  const isUp = rounded > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const text = `${isUp ? "+" : "-"}${Math.abs(rounded).toLocaleString("id-ID", {
    maximumFractionDigits: 1,
  })}%`;

  return (
    <p
      className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
        isUp ? "text-lco-teal" : "text-lco-coral"
      }`}
    >
      <Icon className="h-3 w-3" />
      {text}
      <span className="font-normal text-zinc-400">dari periode sebelumnya</span>
    </p>
  );
}

export function ComparisonCaption({ data }: { data: SalesInsightsData }) {
  const { start, end } = data.previousRange;
  return (
    <p className="-mt-2 mb-5 text-[11px] text-zinc-400">
      Pembanding: {dateFormatter.format(start)} sampai{" "}
      {dateFormatter.format(end)}
    </p>
  );
}

// --------------------------------------------------------
// Kartu dasar
// --------------------------------------------------------

function InsightCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof CreditCard;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-lco-teal/10 text-lco-teal">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-[11px] text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-5 py-8 text-xs text-zinc-500">
      <Inbox className="h-5 w-5 text-zinc-400" />
      {text}
    </div>
  );
}

const thClass =
  "px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500";

// --------------------------------------------------------
// Bauran metode pembayaran
// --------------------------------------------------------

function PaymentMixCard({ data }: { data: SalesInsightsData }) {
  const total = data.paymentMix.reduce((sum, row) => sum + row.amount, 0);

  return (
    <InsightCard
      icon={CreditCard}
      title="Metode Pembayaran"
      subtitle="Dari pembayaran transaksi penjualan, sebelum dikurangi retur."
    >
      {data.paymentMix.length === 0 ? (
        <EmptyRow text="Belum ada pembayaran pada rentang ini." />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {data.paymentMix.map((row) => {
            const share = total > 0 ? (row.amount / total) * 100 : 0;
            return (
              <li key={row.key} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium">{row.label}</span>
                  <span className="font-mono text-xs font-semibold tabular-nums">
                    {formatRupiah(row.amount)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-lco-teal"
                      style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-[11px] text-zinc-500">
                    {share.toLocaleString("id-ID", {
                      maximumFractionDigits: 1,
                    })}
                    % · {row.transactionCount} transaksi
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </InsightCard>
  );
}

// --------------------------------------------------------
// Produk terlaris
// --------------------------------------------------------

function TopProductsCard({ data }: { data: SalesInsightsData }) {
  return (
    <InsightCard
      icon={Package}
      title="Produk Terlaris"
      subtitle="10 produk dengan omzet bersih terbesar (setelah retur)."
    >
      {data.topProducts.length === 0 ? (
        <EmptyRow text="Belum ada produk terjual pada rentang ini." />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className={`${thClass} w-10`}>#</th>
              <th className={thClass}>Produk</th>
              <th className={`${thClass} text-right`}>Terjual</th>
              <th className={`${thClass} text-right`}>Omzet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {data.topProducts.map((product, index) => (
              <tr key={product.key}>
                <td className="px-5 py-2.5 font-mono text-xs tabular-nums text-zinc-400">
                  {index + 1}
                </td>
                <td
                  className="max-w-[12rem] truncate px-5 py-2.5 text-xs"
                  title={product.name}
                >
                  {product.name}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                  {product.qty}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                  {formatRupiah(product.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </InsightCard>
  );
}

// --------------------------------------------------------
// Kas keluar per kategori
// --------------------------------------------------------

function CashOutCard({
  data,
  cashOutError,
}: {
  data: SalesInsightsData;
  cashOutError: string | null;
}) {
  const cashOut = data.cashOut;

  return (
    <InsightCard
      icon={Banknote}
      title="Kas Keluar per Kategori"
      subtitle="Uang keluar dari laci kasir yang dicatat di menu Kas, tanpa catatan yang dibatalkan."
    >
      {cashOut === null ? (
        <div className="flex items-start gap-2 px-5 py-4 text-xs text-lco-coral">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Kas keluar tidak dapat dimuat
          {cashOutError ? `: ${cashOutError}` : "."}
        </div>
      ) : cashOut.rows.length === 0 ? (
        <EmptyRow text="Tidak ada kas keluar pada rentang ini." />
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className={thClass}>Kategori</th>
                <th className={`${thClass} text-right`}>Catatan</th>
                <th className={`${thClass} text-right`}>Nominal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {cashOut.rows.map((row) => (
                <tr key={row.category}>
                  <td className="px-5 py-2.5 text-xs">{row.label}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                    {row.count}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                    {formatRupiah(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-zinc-200 dark:border-zinc-800">
              <tr>
                <td className="px-5 py-2.5 text-xs font-semibold" colSpan={2}>
                  Total kas keluar
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                  {formatRupiah(cashOut.total)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="border-t border-zinc-100 px-5 py-3 text-[11px] text-zinc-500 dark:border-zinc-900">
            Setor ke owner dan belanja stok ikut tercatat sebagai kas keluar,
            tetapi bukan biaya operasional.
          </p>
        </>
      )}
    </InsightCard>
  );
}

// --------------------------------------------------------
// Bagian utama
// --------------------------------------------------------

export function HarianInsightsSection({
  insights,
}: {
  insights: UseSalesInsightsResult;
}) {
  const { data, isLoading, error, cashOutError } = insights;

  if (isLoading || (!data && !error)) {
    return (
      <div className="mb-5 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 py-6 text-xs text-zinc-500 dark:border-zinc-800">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat rincian penjualan...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mb-5 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-xs text-lco-coral">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Rincian penjualan tidak dapat dimuat{error ? `: ${error}` : "."}
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentMixCard data={data} />
        <TopProductsCard data={data} />
      </div>
      <CashOutCard data={data} cashOutError={cashOutError} />
    </div>
  );
}
