"use client";

// app/components/outlet/OutletFormModal.tsx
// ── BARU (migration 048) ── Form "Tambah Outlet Baru" / "Pengaturan <nama outlet>"
// dengan tiga tab, mengikuti alur di aplikasi referensi:
//   1. Profil & Lokasi : nama, kode, telepon, alamat, zona waktu, status aktif.
//   2. Pajak & Poin    : pembulatan total, PPN, service charge, program poin member.
//   3. Format Struk    : lebar kertas, auto-cetak, header & footer struk.
// Satu tombol "Simpan Outlet" menyimpan semua tab sekaligus. Kalau ada isian yang
// tidak valid, form pindah ke tab tempat masalahnya.

import { useState } from "react";
import {
  AlertCircle,
  Building2,
  Link2,
  Loader2,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import {
  ROUNDING_STEPS,
  branchToFormValues,
  roundingLabel,
  validateBranchForm,
  type Branch,
  type BranchFormValues,
} from "@/lib/pos/branches";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Select from "@/app/components/ui/Select";
import Textarea from "@/app/components/ui/Textarea";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";

export type OutletFormTab = "profil" | "pajak" | "struk";

const TABS: { key: OutletFormTab; label: string; icon: LucideIcon }[] = [
  { key: "profil", label: "Profil & Lokasi", icon: Building2 },
  { key: "pajak", label: "Pajak & Poin", icon: Link2 },
  { key: "struk", label: "Format Struk", icon: Receipt },
];

const labelClass = "mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";
const hintClass = "mt-1 text-[11px] text-zinc-500 dark:text-zinc-400";
const boxClass = "rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";
const checkClass = "h-4 w-4 shrink-0 accent-lco-green";

const TIMEZONE_SUGGESTIONS = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];

/** Angka dari kolom input; kosong -> 0 supaya validasi yang menolaknya. */
function toNumber(value: string): number {
  if (value.trim() === "") return 0;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

export default function OutletFormModal({
  branch,
  initialTab = "profil",
  onClose,
  onSubmit,
}: {
  /** null = tambah outlet baru. */
  branch: Branch | null;
  initialTab?: OutletFormTab;
  onClose: () => void;
  onSubmit: (values: BranchFormValues) => Promise<void>;
}) {
  const [tab, setTab] = useState<OutletFormTab>(initialTab);
  const [form, setForm] = useState<BranchFormValues>(() => branchToFormValues(branch));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = branch === null;

  function set<K extends keyof BranchFormValues>(key: K, value: BranchFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const problem = validateBranchForm(form);
    if (problem) {
      setError(problem.message);
      setTab(problem.tab);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan outlet.");
      setSaving(false);
    }
  }

  const title = isNew ? "Tambah Outlet Baru" : `Pengaturan ${branch.name}`;

  return (
    <Modal size="xl" padding="md" aria-label={title}>
      <ModalHeader
        title={<span className="text-lco-green dark:text-lco-teal">{title}</span>}
        icon={<Building2 className="h-4 w-4 text-lco-green dark:text-lco-teal" />}
        onClose={onClose}
        closeDisabled={saving}
        className="mb-1"
      />
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Konfigurasi profil outlet, aturan pajak &amp; loyalty kasir, serta format cetak struk.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div
          role="tablist"
          aria-label="Bagian pengaturan outlet"
          className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors duration-150 ${
                  active
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Tab 1: Profil & Lokasi ── */}
        {tab === "profil" && (
          <div className="space-y-3">
            <div>
              <label className={labelClass} htmlFor="outlet-name">
                Nama Outlet <span className="text-lco-coral">*</span>
              </label>
              <Input
                id="outlet-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Contoh: Cabang Sudirman"
                autoFocus
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="outlet-code">
                  Kode Outlet <span className="text-lco-coral">*</span>
                </label>
                <Input
                  id="outlet-code"
                  className="font-mono"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="Contoh: SDR-01"
                  maxLength={12}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="outlet-phone">
                  No. Telepon
                </label>
                <Input
                  id="outlet-phone"
                  className="font-mono"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="08123456789"
                />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="outlet-address">
                Alamat Lengkap
              </label>
              <Input
                id="outlet-address"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Jl. Jend. Sudirman No. 10"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="outlet-timezone">
                Timezone / Zona Waktu
              </label>
              <Input
                id="outlet-timezone"
                className="font-mono"
                list="outlet-timezone-list"
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                placeholder="Asia/Jakarta"
              />
              <datalist id="outlet-timezone-list">
                {TIMEZONE_SUGGESTIONS.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <p className={hintClass}>
                WIB: Asia/Jakarta · WITA: Asia/Makassar · WIT: Asia/Jayapura
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 border-t border-zinc-100 pt-3 text-xs font-semibold text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                className={checkClass}
                checked={form.is_active}
                onChange={(e) => set("is_active", e.target.checked)}
              />
              Outlet Aktif (Dapat dipilih dan digunakan oleh kasir)
            </label>
          </div>
        )}

        {/* ── Tab 2: Pajak & Poin ── */}
        {tab === "pajak" && (
          <div className="space-y-3">
            <div>
              <label className={labelClass} htmlFor="outlet-rounding">
                Pembulatan Total Belanja di Kasir
              </label>
              <Select
                id="outlet-rounding"
                fullWidth
                value={form.rounding_step}
                onChange={(e) => set("rounding_step", Number(e.target.value))}
              >
                {ROUNDING_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {roundingLabel(step)}
                  </option>
                ))}
              </Select>
              <p className={hintClass}>
                Total belanja saat pembayaran kasir dan struk akan mengikuti aturan pembulatan ini.
                <span className="ml-1 font-semibold text-zinc-600 dark:text-zinc-300">
                  (Tersimpan per outlet; penerapan di kasir menyusul.)
                </span>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className={boxClass}>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    className={checkClass}
                    checked={form.ppn_enabled}
                    onChange={(e) => set("ppn_enabled", e.target.checked)}
                  />
                  Aktifkan Pajak (PPN)
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    aria-label="Tarif PPN (%)"
                    className="w-24 font-mono"
                    inputMode="decimal"
                    fullWidth={false}
                    value={String(form.ppn_rate)}
                    onChange={(e) => set("ppn_rate", toNumber(e.target.value))}
                    disabled={!form.ppn_enabled}
                  />
                  <span className="text-xs text-zinc-500">%</span>
                </div>
              </div>

              <div className={boxClass}>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    className={checkClass}
                    checked={form.service_charge_enabled}
                    onChange={(e) => set("service_charge_enabled", e.target.checked)}
                  />
                  Service Charge
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    aria-label="Tarif service charge (%)"
                    className="w-24 font-mono"
                    inputMode="decimal"
                    fullWidth={false}
                    value={String(form.service_charge_rate)}
                    onChange={(e) => set("service_charge_rate", toNumber(e.target.value))}
                    disabled={!form.service_charge_enabled}
                  />
                  <span className="text-xs text-zinc-500">%</span>
                </div>
                <p className={hintClass}>Tersimpan per outlet; penerapan di kasir menyusul.</p>
              </div>
            </div>

            <div className={boxClass}>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  className={checkClass}
                  checked={form.loyalty_enabled}
                  onChange={(e) => set("loyalty_enabled", e.target.checked)}
                />
                Program Poin Member (Loyalty)
              </label>
              <p className={hintClass}>
                Member mendapatkan poin belanja &amp; dapat menukarkannya sebagai potongan harga di kasir POS.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400" htmlFor="outlet-spend">
                    Rp Belanja per 1 Poin
                  </label>
                  <Input
                    id="outlet-spend"
                    className="font-mono"
                    inputMode="numeric"
                    value={String(form.loyalty_spend_per_point)}
                    onChange={(e) => set("loyalty_spend_per_point", toNumber(e.target.value))}
                    disabled={!form.loyalty_enabled}
                  />
                  <p className={hintClass}>Misal 1.000 = tiap Rp 1.000 dapat 1 poin</p>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400" htmlFor="outlet-value">
                    Nilai Potongan per 1 Poin (Rp)
                  </label>
                  <Input
                    id="outlet-value"
                    className="font-mono"
                    inputMode="numeric"
                    value={String(form.loyalty_point_value)}
                    onChange={(e) => set("loyalty_point_value", toNumber(e.target.value))}
                    disabled={!form.loyalty_enabled}
                  />
                  <p className={hintClass}>Misal 1 = 1 poin bernilai diskon Rp 1</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 3: Format Struk ── */}
        {tab === "struk" && (
          <div className={boxClass}>
            <p className="mb-3 text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Pengaturan Cetak Struk Kasir
            </p>
            <div className="grid items-end gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400" htmlFor="outlet-paper">
                  Lebar Kertas Printer
                </label>
                <Select
                  id="outlet-paper"
                  fullWidth
                  value={form.paper_thermal}
                  onChange={(e) => set("paper_thermal", e.target.value === "58mm" ? "58mm" : "80mm")}
                >
                  <option value="58mm">58 mm (Umum Thermal Portable)</option>
                  <option value="80mm">80 mm (Desktop / Kasir Besar)</option>
                </Select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  className={checkClass}
                  checked={form.auto_print}
                  onChange={(e) => set("auto_print", e.target.checked)}
                />
                Auto cetak struk setelah bayar
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400" htmlFor="outlet-header">
                  Header Struk
                </label>
                <Textarea
                  id="outlet-header"
                  rows={3}
                  value={form.receipt_header}
                  onChange={(e) => set("receipt_header", e.target.value)}
                  placeholder="Contoh: Selamat datang di toko kami"
                />
                <p className={hintClass}>Teks bagian atas struk di bawah nama toko</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400" htmlFor="outlet-footer">
                  Footer Struk
                </label>
                <Textarea
                  id="outlet-footer"
                  rows={3}
                  value={form.receipt_footer}
                  onChange={(e) => set("receipt_footer", e.target.value)}
                  placeholder="Contoh: Terima kasih atas kunjungan Anda"
                />
                <p className={hintClass}>Teks ucapan di bagian paling bawah struk</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Menyimpan..." : "Simpan Outlet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
