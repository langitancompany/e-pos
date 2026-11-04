"use client";

// app/components/outlet/OutletModule.tsx
// ── BARU (migration 048) ── Menu Pengaturan > Outlet ("Kelola outlet"): daftar
// outlet/cabang sebagai kartu, filter Semua/Aktif/Nonaktif, pencarian, tambah
// outlet, dan pengaturan lengkap tiap outlet lewat OutletFormModal.
// Menggantikan kartu "Cabang / Toko" yang dulu ada di Pengaturan > Toko & Struk.
//
// Izin (juga ditegakkan RLS tabel `branches`):
//   lihat            : permission `pengaturan_toko` (gate menu & halaman ini)
//   tambah           : pengaturan_toko.create
//   ubah/nonaktifkan : pengaturan_toko.edit
// Outlet tidak bisa dihapus (transaksi merujuk ke sana) — cukup dinonaktifkan.

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Clock,
  Coins,
  Loader2,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  Power,
  Receipt,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Percent,
  FileText,
  ArrowLeft,
  Settings2,
} from "lucide-react";
import { hasPermission, hasPermissionAction, useAuth } from "@/hooks/useAuth";
import { useBranches } from "@/hooks/useBranches";
import { useActiveBranch } from "@/hooks/useActiveBranch";
import { timezoneLabel, type Branch } from "@/lib/pos/branches";
import Button from "@/app/components/ui/Button";
import OutletFormModal, { type OutletFormTab } from "./OutletFormModal";
import OutletUmumPanel from "./OutletUmumPanel";

type StatusFilter = "all" | "active" | "inactive";

function formatPercent(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function SummaryItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Percent;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </p>
      <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}

function OutletCard({
  branch,
  isCurrent,
  canEdit,
  busy,
  onSettings,
  onReceipt,
  onUse,
  onToggle,
}: {
  branch: Branch;
  isCurrent: boolean;
  canEdit: boolean;
  busy: boolean;
  onSettings: () => void;
  onReceipt: () => void;
  onUse: () => void;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const showMenu = (branch.is_active && !isCurrent) || canEdit;

  return (
    <li
      className={`relative flex flex-col rounded-xl border bg-white dark:bg-zinc-900 ${
        isCurrent
          ? "border-zinc-200 border-t-2 border-t-lco-green dark:border-zinc-800 dark:border-t-lco-teal"
          : "border-zinc-200 dark:border-zinc-800"
      } ${branch.is_active ? "" : "opacity-70"}`}
    >
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lco-green/10 text-lco-green dark:text-lco-teal">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {isCurrent && (
              <span className="rounded-md bg-lco-green/10 px-2 py-0.5 text-[10px] font-semibold text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal">
                Sedang dipilih
              </span>
            )}
            <span
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                branch.is_active
                  ? "bg-lco-green/10 text-lco-green dark:bg-lco-teal/15 dark:text-lco-teal"
                  : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${branch.is_active ? "bg-lco-green dark:bg-lco-teal" : "bg-zinc-400"}`}
              />
              {branch.is_active ? "Aktif" : "Nonaktif"}
            </span>
          </div>
        </div>

        <h3 className="mt-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">{branch.name}</h3>
        {branch.code && (
          <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{branch.code}</p>
        )}

        <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{branch.address || <em className="text-zinc-400">alamat belum diisi</em>}</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Phone className="h-3 w-3 shrink-0" />
            {branch.phone || <em className="text-zinc-400">telepon belum diisi</em>}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 shrink-0" />
            {timezoneLabel(branch.timezone)}
          </span>
        </p>

        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950/60">
          <SummaryItem
            icon={Percent}
            label="Pajak"
            value={branch.ppn_enabled ? `PPN ${formatPercent(branch.ppn_rate)}` : "Tidak aktif"}
          />
          <SummaryItem
            icon={Percent}
            label="Service charge"
            value={
              branch.service_charge_enabled
                ? formatPercent(branch.service_charge_rate)
                : "Tidak aktif"
            }
          />
          <SummaryItem icon={FileText} label="Kertas struk" value={branch.paper_thermal.replace("mm", " mm")} />
          <SummaryItem
            icon={Coins}
            label="Poin member"
            value={branch.loyalty_enabled ? "Aktif" : "Tidak aktif"}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-zinc-100 p-2 dark:border-zinc-800">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={onSettings}
          disabled={!canEdit}
          title={canEdit ? undefined : "Anda tidak punya izin mengubah outlet"}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Pengaturan outlet
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReceipt}
          disabled={!canEdit}
          title="Atur format struk outlet ini"
        >
          <Receipt className="h-3.5 w-3.5" /> Struk
        </Button>
        {showMenu && (
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Menu outlet ${branch.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              onBlur={() => window.setTimeout(() => setMenuOpen(false), 150)}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
            {menuOpen && (
              <ul
                role="menu"
                className="absolute bottom-full right-0 z-20 mb-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
              >
                {branch.is_active && !isCurrent && (
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setMenuOpen(false);
                        onUse();
                      }}
                    >
                      <Check className="h-3.5 w-3.5" /> Pakai outlet ini
                    </button>
                  </li>
                )}
                {canEdit && (
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setMenuOpen(false);
                        onToggle();
                      }}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {branch.is_active ? "Nonaktifkan outlet" : "Aktifkan outlet"}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function OutletModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { branches, isLoading, error, addBranch, updateBranch, setBranchActive } = useBranches();
  const { activeBranchId, setActiveBranch } = useActiveBranch();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ branch: Branch | null; tab: OutletFormTab } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // "umum" = pengaturan yang berlaku untuk semua outlet (dulu Pengaturan > Toko & Struk).
  const [view, setView] = useState<"daftar" | "umum">("daftar");

  const canView = hasPermission(user, "pengaturan_toko");
  const canCreate = hasPermissionAction(user, "pengaturan_toko", "create");
  const canEdit = hasPermissionAction(user, "pengaturan_toko", "edit");

  const counts = useMemo(
    () => ({
      all: branches.length,
      active: branches.filter((b) => b.is_active).length,
      inactive: branches.filter((b) => !b.is_active).length,
    }),
    [branches],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => {
      if (filter === "active" && !b.is_active) return false;
      if (filter === "inactive" && b.is_active) return false;
      if (!q) return true;
      return [b.name, b.code, b.address].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [branches, filter, query]);

  // Database belum di-migrate ke 048: kartu tetap tampil, tapi beri petunjuk jelas.
  const needsMigration = branches.length > 0 && branches.some((b) => !b.has_settings);

  async function handleToggle(b: Branch) {
    setBusyId(b.id);
    setActionError(null);
    try {
      await setBranchActive(b.id, !b.is_active);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah status outlet.");
    } finally {
      setBusyId(null);
    }
  }

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Akun Anda tidak punya izin mengelola outlet. Hubungi admin kalau ini seharusnya tidak terjadi.
        </p>
      </div>
    );
  }

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "Semua" },
    { key: "active", label: "Aktif" },
    { key: "inactive", label: "Nonaktif" },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 dark:bg-zinc-950 md:p-6">
      {/* Kepala halaman */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lco-green/10 text-lco-green dark:text-lco-teal">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Kelola outlet</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Atur informasi toko, pajak, dan struk untuk setiap cabang.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view === "umum" ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setView("daftar")}>
              <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke daftar
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => setView("umum")}>
                <Settings2 className="h-3.5 w-3.5" /> Pengaturan Umum
              </Button>
              {canCreate && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setEditing({ branch: null, tab: "profil" })}
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah Outlet
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {view === "umum" ? (
        <>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Pengaturan di bawah berlaku untuk semua outlet. Nama, alamat, PPN, poin, dan
            struk diatur per outlet lewat &quot;Pengaturan outlet&quot; di tiap kartu.
          </p>
          <OutletUmumPanel />
        </>
      ) : (
      <>

      {/* Filter + pencarian */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter status outlet"
          className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {filterTabs.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  active
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {label}
                <span className="rounded bg-zinc-200/70 px-1.5 text-[10px] dark:bg-zinc-700">
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama, kode, atau alamat..."
            aria-label="Cari outlet"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-zinc-400 focus:border-lco-teal focus:ring-2 focus:ring-lco-teal/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>

      {(error || actionError || needsMigration) && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError ??
            (error
              ? `Gagal memuat outlet: ${error}. Pastikan migration 047 dan 048 sudah dijalankan.`
              : "Pengaturan per outlet belum aktif. Jalankan migration 048_outlet_settings.sql di Supabase, lalu muat ulang halaman.")}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat outlet...
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            {counts.all} outlet terdaftar
            {visible.length !== counts.all && ` · ${visible.length} ditampilkan`}
          </p>
          <ul className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((b) => (
              <OutletCard
                key={b.id}
                branch={b}
                isCurrent={b.id === activeBranchId}
                canEdit={canEdit}
                busy={busyId === b.id}
                onSettings={() => setEditing({ branch: b, tab: "profil" })}
                onReceipt={() => setEditing({ branch: b, tab: "struk" })}
                onUse={() => setActiveBranch(b.id)}
                onToggle={() => handleToggle(b)}
              />
            ))}
            {canCreate && filter !== "inactive" && query.trim() === "" && (
              <li className="flex">
                <button
                  type="button"
                  onClick={() => setEditing({ branch: null, tab: "profil" })}
                  className="flex min-h-[240px] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-lco-green/30 bg-lco-green/5 p-6 text-center transition-colors duration-150 hover:border-lco-green/60 hover:bg-lco-green/10 dark:border-lco-teal/30 dark:bg-lco-teal/5"
                >
                  <Plus className="mb-1 h-5 w-5 text-lco-green dark:text-lco-teal" />
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Tambah cabang baru
                  </span>
                  <span className="max-w-[200px] text-xs text-zinc-500 dark:text-zinc-400">
                    Siapkan outlet berikutnya dengan pengaturan tersendiri.
                  </span>
                </button>
              </li>
            )}
          </ul>
          {visible.length === 0 && (
            <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {branches.length === 0 ? "Belum ada outlet." : "Tidak ada outlet yang cocok."}
            </p>
          )}
        </>
      )}

      </>
      )}

      {editing && (
        <OutletFormModal
          key={`${editing.branch?.id ?? "new"}-${editing.tab}`}
          branch={editing.branch}
          initialTab={editing.tab}
          onClose={() => setEditing(null)}
          onSubmit={(values) =>
            editing.branch ? updateBranch(editing.branch.id, values) : addBranch(values)
          }
        />
      )}
    </div>
  );
}
