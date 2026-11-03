"use client";

// app/components/laporan/TrafficTab.tsx
// ── TAMBAHAN (Laporan, adopsi ide dari tab "Jam & Hari Ramai" Kula POS) ──
// Tab "Jam & Hari Ramai": jam tersibuk, hari tersibuk, grafik transaksi per
// jam, rincian per jam, dan per hari dalam seminggu. Data dari
// hooks/useHourlyTraffic.ts (hitungan di lib/pos/reportTraffic.ts).
//
// Pola visual disamakan dengan LaporanModule.tsx (kartu rounded-xl, warna
// lco-teal / lco-mustard / lco-coral, icon lucide). Ikut tertangkap saat
// export PDF tab ini (snapshot DOM).

import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Inbox,
  Loader2,
  Receipt,
} from "lucide-react";
import { formatRupiah } from "@/lib/pos/cartLogic";
import type { TrafficReport } from "@/lib/pos/reportTraffic";
import type { UseHourlyTrafficResult } from "@/hooks/useHourlyTraffic";

const thClass =
  "px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500";

function KpiCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {value}
      </p>
      {note && <p className="mt-1 text-[11px] text-zinc-500">{note}</p>}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-[11px] text-zinc-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function HourlyChart({ traffic }: { traffic: TrafficReport }) {
  const max = Math.max(1, ...traffic.hourly.map((point) => point.count));
  const peakHour = traffic.peakHour?.hour ?? -1;

  return (
    <div className="px-5 pb-4 pt-5">
      <div
        className="flex h-40 items-end gap-1"
        role="img"
        aria-label="Grafik jumlah transaksi per jam"
      >
        {traffic.hourly.map((point) => {
          const height =
            point.count > 0 ? Math.max(4, (point.count / max) * 100) : 2;
          const color =
            point.count === 0
              ? "bg-zinc-200 dark:bg-zinc-800"
              : point.hour === peakHour
                ? "bg-lco-mustard"
                : "bg-lco-teal";
          return (
            <div
              key={point.hour}
              className="flex h-full flex-1 items-end"
              title={`${point.label}: ${point.count} transaksi, ${formatRupiah(point.revenue)}`}
            >
              <div
                className={`w-full rounded-t ${color}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {traffic.hourly.map((point) => (
          <div
            key={point.hour}
            className="flex-1 text-center text-[9px] tabular-nums text-zinc-400"
          >
            {point.hour % 3 === 0 ? String(point.hour).padStart(2, "0") : ""}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Batang kuning menandai jam tersibuk. Arahkan kursor ke batang untuk
        melihat rinciannya.
      </p>
    </div>
  );
}

function HourlyTable({ traffic }: { traffic: TrafficReport }) {
  const active = traffic.hourly.filter((point) => point.count > 0);

  return (
    <Card title="Rincian per Jam" subtitle="Hanya jam yang ada transaksinya.">
      {active.length === 0 ? (
        <EmptyState text="Belum ada transaksi pada rentang ini." />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className={thClass}>Jam</th>
              <th className={`${thClass} text-right`}>Transaksi</th>
              <th className={`${thClass} text-right`}>Omzet</th>
              <th className={`${thClass} text-right`}>Rata-rata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {active.map((point) => (
              <tr key={point.hour}>
                <td className="px-5 py-2.5 font-mono text-xs tabular-nums">
                  {point.label}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                  {point.count}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                  {formatRupiah(point.revenue)}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                  {formatRupiah(point.averageSpend)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function WeekdayCard({ traffic }: { traffic: TrafficReport }) {
  const max = Math.max(1, ...traffic.weekdays.map((point) => point.count));
  const busiest = traffic.busiestDay?.day ?? -1;

  return (
    <Card
      title="Per Hari dalam Seminggu"
      subtitle="Seluruh rentang tanggal dijumlahkan per nama hari."
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {traffic.weekdays.map((point) => (
          <li key={point.day} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium">{point.name}</span>
              <span className="font-mono text-xs tabular-nums text-zinc-500">
                {point.count} transaksi · {formatRupiah(point.revenue)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full ${
                  point.day === busiest ? "bg-lco-mustard" : "bg-lco-teal"
                }`}
                style={{ width: `${(point.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-5 py-8 text-xs text-zinc-500">
      <Inbox className="h-5 w-5 text-zinc-400" />
      {text}
    </div>
  );
}

export function TrafficTab({ traffic }: { traffic: UseHourlyTrafficResult }) {
  const { data, isLoading, error } = traffic;

  if (isLoading || (!data && !error)) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat data jam ramai...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Data jam ramai tidak dapat dimuat{error ? `: ${error}` : "."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          icon={Clock}
          label="Jam Tersibuk"
          value={data.peakHour ? data.peakHour.label : "-"}
          note={
            data.peakHour
              ? `${data.peakHour.count} transaksi · ${formatRupiah(data.peakHour.revenue)}`
              : "Belum ada transaksi"
          }
        />
        <KpiCard
          icon={CalendarDays}
          label="Hari Tersibuk"
          value={data.busiestDay ? data.busiestDay.name : "-"}
          note={
            data.busiestDay
              ? `${data.busiestDay.count} transaksi · ${formatRupiah(data.busiestDay.revenue)}`
              : "Belum ada transaksi"
          }
        />
        <KpiCard
          icon={Receipt}
          label="Total Transaksi"
          value={String(data.totalCount)}
          note={`Omzet penjualan ${formatRupiah(data.totalRevenue)}`}
        />
      </div>

      <Card
        title="Transaksi per Jam"
        subtitle="Dihitung dari transaksi penjualan menurut jam pembuatan, sebelum dikurangi retur."
      >
        {data.totalCount === 0 ? (
          <EmptyState text="Belum ada transaksi pada rentang ini." />
        ) : (
          <HourlyChart traffic={data} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <HourlyTable traffic={data} />
        <WeekdayCard traffic={data} />
      </div>
    </div>
  );
}
