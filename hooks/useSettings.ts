// hooks/useSettings.ts
// ── TAMBAHAN ── Hook domain Settings (PRD §17 T-01): baca tabel key-value `settings`
// (migration 005_settings.sql) dan parse jadi objek typed, dipakai di seluruh app.
// Konsumen pertama: KasirModule.tsx & PaymentModal.tsx (baris PPN muncul/hilang
// sesuai `ppn_enabled` — lihat Definition of Done T-01). UI Pengaturan sendiri
// menyusul di T-10 — hook ini sudah menyediakan `updateSetting` untuk dipakai nanti,
// supaya T-10 tidak perlu bongkar hook ini lagi.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
// ── TAMBAHAN (migration 047, multi cabang) ── Identitas toko mengikuti cabang aktif.
import { useActiveBranch } from "@/hooks/useActiveBranch";
import { branchSettingsOverlay } from "@/lib/pos/branches";

const supabase = createClient();

// Baris asli tabel `settings` (migration 005) — key-value, value disimpan jsonb.
interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Bentuk siap-pakai di client, sudah di-parse dari jsonb & diberi nama camelCase. */
export interface Settings {
  namaToko: string;
  alamat: string;
  telepon: string;
  footerStruk: string;
  /** Kalau true, PaymentModal & struk menampilkan baris pajak (PRD §17 T-01 DoD). */
  ppnEnabled: boolean;
  /** Persentase, mis. 11 → 11%. Hanya dipakai kalau ppnEnabled = true. */
  ppnRate: number;
  /** Pembulatan kembalian tunai ke kelipatan ini (rupiah). Disiapkan untuk T-02/T-03. */
  rounding: number;
  /** Modal awal kas default saat buka shift. Dipakai mulai T-04. */
  shiftDefaultCash: number;
  /** Dipakai mulai T-03. */
  printDefault: "struk" | "nota";
  paperNota: "A6" | "A5";
  paperThermal: "58mm" | "80mm";
  /** Dipakai mulai T-10 (kontrol tampil/sembunyi harga modal, permission `harga_modal`). */
  showCostPrice: boolean;
  /** Tampilkan QR promosi di bagian paling bawah struk penjualan (thermal). */
  promoEnabled: boolean;
  /** Link tujuan QR (mis. Linktree). Kosong/tidak valid -> QR tidak dicetak. */
  promoUrl: string;
  /** Teks ajakan di atas QR. Kosong -> "Scan untuk ikuti kami". */
  promoText: string;
  /** Kalau false, metode Digital (Midtrans) disembunyikan di kasir & ditolak server. */
  digitalPaymentEnabled: boolean;
}

// Default fallback — SENGAJA persis sama dengan seed di migration 005_settings.sql.
// Dipakai selama fetch pertama masih berjalan (isLoading) dan kalau fetch gagal,
// supaya layar Kasir tidak pernah crash / tidak pernah tiba-tiba menampilkan pajak
// yang salah hanya karena request settings belum selesai.
export const DEFAULT_SETTINGS: Settings = {
  namaToko: "Langitan.co",
  alamat: "",
  telepon: "",
  footerStruk: "Terima kasih atas kunjungan Anda",
  ppnEnabled: false,
  ppnRate: 11,
  rounding: 100,
  shiftDefaultCash: 0,
  printDefault: "nota",
  paperNota: "A6",
  paperThermal: "80mm",
  showCostPrice: false,
  promoEnabled: false,
  promoUrl: "",
  promoText: "Scan untuk ikuti kami",
  // Sengaja false: kalau fetch gagal/migration 036 belum jalan, kasir aman (tunai saja).
  digitalPaymentEnabled: false,
};

// Pemetaan key DB (snake_case, sesuai migration) -> field Settings (camelCase).
// Satu sumber kebenaran dipakai dua arah: parse hasil select, dan tulis balik di updateSetting.
const KEY_MAP: Record<keyof Settings, string> = {
  namaToko: "nama_toko",
  alamat: "alamat",
  telepon: "telepon",
  footerStruk: "footer_struk",
  ppnEnabled: "ppn_enabled",
  ppnRate: "ppn_rate",
  rounding: "rounding",
  shiftDefaultCash: "shift_default_cash",
  printDefault: "print_default",
  paperNota: "paper_nota",
  paperThermal: "paper_thermal",
  showCostPrice: "show_cost_price",
  promoEnabled: "promo_enabled",
  promoUrl: "promo_url",
  promoText: "promo_text",
  digitalPaymentEnabled: "digital_payment_enabled",
};

function parseSettings(rows: SettingRow[]): Settings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...DEFAULT_SETTINGS };

  (Object.keys(KEY_MAP) as (keyof Settings)[]).forEach((field) => {
    const dbKey = KEY_MAP[field];
    if (!byKey.has(dbKey)) return; // key belum ada di DB (mis. migration belum jalan) -> pakai default

    const raw = byKey.get(dbKey);
    // value jsonb sudah otomatis ke-decode jadi tipe JS asli (boolean/number/string) oleh
    // supabase-js, jadi cukup type-assert saja sesuai bentuk Settings.
    (result as Record<string, unknown>)[field] = raw;
  });

  return result;
}

/**
 * ── TAMBAHAN (migration 048) ── Pengaturan yang hanya ada PER OUTLET (tidak ada
 * padanan di tabel `settings` global). Tanpa outlet aktif / migration belum
 * jalan, nilainya meniru perilaku lama: tanpa header struk, auto-cetak
 * menyala, poin aktif dengan aturan lama (10.000 = 1 poin, 1 poin = Rp 100).
 */
export interface OutletSettings {
  /** Teks di bagian atas struk, di bawah nama toko. Kosong = tidak dicetak. */
  headerStruk: string;
  /** Cetak struk otomatis setelah pembayaran berhasil. */
  autoPrint: boolean;
  /** Program poin member aktif di outlet ini. */
  loyaltyEnabled: boolean;
  /** Rp belanja untuk mendapat 1 poin (server yang menghitung perolehan poin). */
  loyaltySpendPerPoint: number;
  /** Nilai rupiah 1 poin saat ditukar jadi potongan. */
  loyaltyPointValue: number;
  /** Zona waktu IANA outlet, mis. "Asia/Jakarta". */
  timezone: string;
}

export const DEFAULT_OUTLET_SETTINGS: OutletSettings = {
  headerStruk: "",
  autoPrint: true,
  loyaltyEnabled: true,
  loyaltySpendPerPoint: 10000,
  loyaltyPointValue: 100,
  timezone: "Asia/Jakarta",
};

interface UseSettingsResult {
  settings: Settings;
  /** Pengaturan khusus outlet aktif (header struk, auto-cetak, poin, zona waktu). */
  outlet: OutletSettings;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Update 1 setting. Ditolak oleh RLS (migration 005) kalau bukan admin —
   * lempar Error dengan pesan dari Postgres, tangani di UI pemanggil (T-10).
   */
  updateSetting: <K extends keyof Settings>(
    field: K,
    value: Settings[K],
  ) => Promise<void>;
}

/**
 * ── PERUBAHAN (migration 047, multi cabang) ── Secara bawaan `namaToko`,
 * `alamat`, dan `telepon` DITIMPA data cabang yang sedang dipilih (kalau cabang
 * mengisinya), sehingga judul kasir, badge header, dan struk otomatis memakai
 * identitas cabang tanpa mengubah satu pun pemanggil lama. Migration 048
 * menambah PPN, lebar kertas, dan footer struk ke daftar itu. Alamat/telepon
 * cabang yang kosong jatuh ke nilai global di Pengaturan > Toko.
 *
 * `{ raw: true }` mengembalikan nilai global apa adanya — WAJIB dipakai form
 * Pengaturan > Toko & Struk supaya yang diedit dan disimpan benar-benar
 * pengaturan global, bukan data cabang.
 */
export function useSettings(options: { raw?: boolean } = {}): UseSettingsResult {
  const raw = options.raw === true;
  const { activeBranch } = useActiveBranch();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("settings")
      .select("*");

    if (fetchError) {
      setError(fetchError.message);
      // Baris TIDAK dikosongkan ke [] di sini secara sengaja — biarkan `settings`
      // (lihat useMemo di bawah) tetap jatuh ke DEFAULT_SETTINGS lewat parseSettings([]),
      // supaya layar Kasir tetap bisa dipakai (PPN dianggap off) walau fetch gagal.
      setRows([]);
    } else {
      setRows((data ?? []) as SettingRow[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const settings = useMemo(() => {
    const base = parseSettings(rows);
    if (raw || !activeBranch) return base;
    const identity = {
      ...base,
      namaToko: activeBranch.name || base.namaToko,
      alamat: activeBranch.address ?? base.alamat,
      telepon: activeBranch.phone ?? base.telepon,
    };
    // ── PERUBAHAN (migration 048) ── PPN, lebar kertas, dan footer struk juga
    // mengikuti outlet aktif. Footer outlet kosong -> pakai footer global.
    // `o` null = database belum di-migrate -> pengaturan global tetap berlaku.
    const o = branchSettingsOverlay(activeBranch);
    if (!o) return identity;
    return {
      ...identity,
      ppnEnabled: o.ppnEnabled,
      ppnRate: o.ppnRate,
      paperThermal: o.paperThermal,
      footerStruk: o.footerStruk ?? base.footerStruk,
    };
  }, [rows, raw, activeBranch]);

  const outlet = useMemo<OutletSettings>(() => {
    if (raw || !activeBranch) return DEFAULT_OUTLET_SETTINGS;
    const o = branchSettingsOverlay(activeBranch);
    if (!o) return DEFAULT_OUTLET_SETTINGS;
    return {
      headerStruk: o.headerStruk,
      autoPrint: o.autoPrint,
      loyaltyEnabled: o.loyaltyEnabled,
      loyaltySpendPerPoint: o.loyaltySpendPerPoint,
      loyaltyPointValue: o.loyaltyPointValue,
      timezone: o.timezone,
    };
  }, [raw, activeBranch]);

  const updateSetting = useCallback(
    async <K extends keyof Settings>(field: K, value: Settings[K]) => {
      const dbKey = KEY_MAP[field];

      const {
        data: { user },
      } = await supabase.auth.getUser();

      // upsert (bukan update): kalau key belum ada di DB (mis. migration 034
      // belum dijalankan), baris dibuat, bukan diam-diam "berhasil" tanpa
      // mengubah apa pun. `description` tidak ikut dikirim, jadi baris lama
      // tidak kehilangan keterangannya. RLS tetap admin-only (insert & update).
      const { error: updateError } = await supabase.from("settings").upsert(
        {
          key: dbKey,
          value,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        },
        { onConflict: "key" },
      );

      if (updateError) {
        throw new Error(
          updateError.message || `Gagal menyimpan pengaturan "${dbKey}".`,
        );
      }

      await fetchSettings();
    },
    [fetchSettings],
  );

  return { settings, outlet, isLoading, error, refetch: fetchSettings, updateSetting };
}