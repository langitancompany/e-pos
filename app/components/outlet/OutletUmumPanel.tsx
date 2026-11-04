"use client";

// app/components/outlet/OutletUmumPanel.tsx
// ── DIPINDAHKAN (migration 048) ── Dulu tab "Toko & Struk" di Pengaturan
// (PengaturanTokoTab.tsx). Sekarang bagian dari menu Outlet, lewat tombol
// "Pengaturan Umum" di halaman Kelola outlet.
//
// Yang SUDAH per outlet dan karena itu dihapus dari form ini (diatur di form
// "Pengaturan outlet"): nama toko, telepon, alamat, footer struk, PPN, dan
// ukuran kertas thermal.
// Yang MASIH berlaku untuk SEMUA outlet (tabel `settings` global): pembulatan
// kembalian tunai, modal awal kas, format cetak default, ukuran kertas nota,
// pembayaran digital, promosi QR di struk, dan tampil harga modal.
//
// Form edit tabel `settings` lewat `hooks/useSettings.ts` (mode raw = nilai
// global apa adanya, tanpa ditimpa outlet). Submit hanya mengirim field yang
// berubah. RLS `settings` admin-only untuk INSERT/UPDATE.

import MoneyInput from "@/app/components/ui/MoneyInput";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { useSettings, type Settings } from "@/hooks/useSettings";
import { normalizePromoUrl } from "@/lib/pos/receiptQr";
import Select from "@/app/components/ui/Select";
import Input from "@/app/components/ui/Input";
import Button from "@/app/components/ui/Button";
import Textarea from "@/app/components/ui/Textarea";

const labelClass =
  "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

export default function OutletUmumPanel() {
  // raw: form ini mengedit pengaturan GLOBAL, bukan identitas cabang aktif.
  const { settings, isLoading, error, updateSetting } = useSettings({ raw: true });

  const [form, setForm] = useState<Settings>(settings);
  // Dipakai supaya sinkronisasi awal dari `settings` -> `form` cuma terjadi
  // SEKALI (saat fetch pertama selesai), bukan tiap kali `settings` berubah
  // referensi — lihat catatan pola di atas.
  const [hasSynced, setHasSynced] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isLoading && !hasSynced) {
      setForm(settings);
      setHasSynced(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasSynced]);

  function updateField<K extends keyof Settings>(field: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveSuccess(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);

    try {
      // Hanya kirim field yang benar-benar berubah dibanding `settings` asli
      // (lihat catatan pola di atas) — dibandingkan terhadap `settings`
      // (bukan `form` sebelum submit), supaya perubahan dari sesi lain yang
      // sempat masuk lewat refetch juga ikut terhitung "berubah" kalau perlu
      // ditimpa ulang.
      // Link promosi: dirapikan dulu ("linktr.ee/x" -> "https://linktr.ee/x").
      // Link yang diisi tapi tidak valid ditolak SEBELUM menyimpan apa pun,
      // supaya admin tahu sekarang, bukan baru sadar saat QR tidak keluar.
      // Kalau promosi dimatikan, isian link tidak divalidasi.
      let finalForm = form;
      const rawPromoUrl = form.promoUrl.trim();
      if (form.promoEnabled && rawPromoUrl) {
        const normalized = normalizePromoUrl(rawPromoUrl);
        if (!normalized) {
          setSaveError(
            "Link promosi tidak valid. Contoh: https://linktr.ee/langitan.co",
          );
          setIsSaving(false);
          return;
        }
        finalForm = { ...form, promoUrl: normalized };
        setForm(finalForm);
      } else if (rawPromoUrl !== form.promoUrl) {
        finalForm = { ...form, promoUrl: rawPromoUrl };
      }

      const changedFields = (
        Object.keys(finalForm) as (keyof Settings)[]
      ).filter((field) => finalForm[field] !== settings[field]);

      if (changedFields.length === 0) {
        setIsSaving(false);
        return;
      }

      for (const field of changedFields) {
        // eslint-disable-next-line no-await-in-loop
        await updateSetting(field, finalForm[field]);
      }

      setSaveSuccess(true);
    } catch (submitError) {
      setSaveError(
        submitError instanceof Error
          ? submitError.message
          : "Gagal menyimpan pengaturan.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading && !hasSynced) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat pengaturan...
      </div>
    );
  }

  return (
    <div className="space-y-4">
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-sm text-lco-coral">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Gagal memuat pengaturan tersimpan: {error}. Form di bawah memakai
          nilai default sementara.
        </div>
      )}

      {/* ── Kasir & Shift ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Kasir & Shift
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Pembulatan Kembalian Tunai (Rp)
            </label>
            <MoneyInput
            size="lg"
              value={form.rounding}
              onValueChange={(raw) => updateField("rounding", Number(raw))}
              disabled={isSaving}
              className="font-mono tabular-nums"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Kembalian tunai dibulatkan ke kelipatan ini, mis. 100.
            </p>
          </div>
          <div>
            <label className={labelClass}>Modal Awal Kas Default (Rp)</label>
            <MoneyInput
            size="lg"
              value={form.shiftDefaultCash}
              onValueChange={(raw) =>
                updateField("shiftDefaultCash", Number(raw))
              }
              disabled={isSaving}
              className="font-mono tabular-nums"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Nilai awal yang disarankan saat kasir membuka shift baru.
            </p>
          </div>
        </div>
      </div>

      {/* ── Cetak ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Format Cetak
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Format Default</label>
            <Select
              size="lg"
              fullWidth
              value={form.printDefault}
              onChange={(e) =>
                updateField(
                  "printDefault",
                  e.target.value as Settings["printDefault"],
                )
              }
              disabled={isSaving}
            >
              <option value="struk">Struk Thermal</option>
              <option value="nota">Nota A6/A5</option>
            </Select>
          </div>
          <div>
            <label className={labelClass}>Ukuran Kertas Nota</label>
            <Select
              size="lg"
              fullWidth
              value={form.paperNota}
              onChange={(e) =>
                updateField(
                  "paperNota",
                  e.target.value as Settings["paperNota"],
                )
              }
              disabled={isSaving}
            >
              <option value="A6">A6</option>
              <option value="A5">A5</option>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Pembayaran digital (Midtrans) ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Pembayaran Digital
        </h3>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <input
            type="checkbox"
            checked={form.digitalPaymentEnabled}
            onChange={(e) =>
              updateField("digitalPaymentEnabled", e.target.checked)
            }
            disabled={isSaving}
            className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
          />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Aktifkan pembayaran digital (Midtrans)
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Kalau dimatikan, kasir hanya menampilkan Tunai dan Piutang. Kunci
              Midtrans tetap diatur di server (.env). Kasir yang sedang membuka
              halaman perlu me-refresh agar perubahan berlaku.
            </p>
          </div>
        </label>
      </div>

      {/* ── Promosi di struk ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Promosi di Struk
        </h3>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <input
            type="checkbox"
            checked={form.promoEnabled}
            onChange={(e) => updateField("promoEnabled", e.target.checked)}
            disabled={isSaving}
            className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
          />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Tampilkan promosi di struk
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Mencetak teks ajakan dan QR di bagian paling bawah struk penjualan
              (tidak di struk Buka Kasir).
            </p>
          </div>
        </label>

        {form.promoEnabled && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Link Promosi (untuk QR)</label>
              <Input
                type="text"
                inputMode="url"
                value={form.promoUrl}
                onChange={(e) => updateField("promoUrl", e.target.value)}
                disabled={isSaving}
                placeholder="mis. linktr.ee/langitan.co"
                size="lg"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Pakai link pendek (Linktree / link-in-bio) supaya QR lebih besar
                dan mudah discan di kertas 58mm. Link boleh diganti kapan saja;
                berlaku di struk berikutnya. Kalau kosong atau tidak valid, QR
                tidak dicetak.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Teks Ajakan</label>
              <Input
                type="text"
                value={form.promoText}
                onChange={(e) => updateField("promoText", e.target.value)}
                disabled={isSaving}
                maxLength={60}
                placeholder="Scan untuk ikuti kami"
                size="lg"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Harga modal ── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Harga Modal
        </h3>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <input
            type="checkbox"
            checked={form.showCostPrice}
            onChange={(e) => updateField("showCostPrice", e.target.checked)}
            disabled={isSaving}
            className="h-4 w-4 rounded border-zinc-300 text-lco-green focus:ring-lco-teal"
          />
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Tampilkan harga modal
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Kalau aktif, layar yang butuh permission{" "}
              <code className="font-mono">harga_modal</code> (PRD §5) akan
              menampilkan harga modal produk.
            </p>
          </div>
        </label>
      </div>

      {/* ── Aksi ── */}
      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button
          type="submit"
          disabled={isSaving}
          size="lg"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Simpan Perubahan
        </Button>

        {saveSuccess && (
          <span className="flex items-center gap-1.5 text-sm text-lco-green">
            <CheckCircle2 className="h-4 w-4" />
            Tersimpan.
          </span>
        )}

        {saveError && (
          <span className="flex items-center gap-1.5 text-sm text-lco-coral">
            <AlertCircle className="h-4 w-4" />
            {saveError}
          </span>
        )}
      </div>
    </form>
    </div>
  );
}
