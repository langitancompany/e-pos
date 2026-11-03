"use client";

// ── REVISI (Fase 1 perbaikan Stok & Opname) ── Modul Stok & Opname (PRD §17 T-05
// + §4.3 "Mutasi stok"). Sebelumnya satu layar berisi riwayat mutasi saja; kini
// jadi "shell" tipis dengan empat tab (pola yang sama dengan PengaturanModule):
//   1. Stok Saat Ini  — StokSaatIniTab.tsx   (stok, minimum, status, nilai persediaan)
//   2. Barang Masuk   — BarangMasukTab.tsx   (penerimaan barang: supplier, nota, harga beli)
//   3. Sesi Opname    — OpnameTab.tsx        (daftar sesi + layar hitung)
//   4. Riwayat Mutasi — StokRiwayatTab.tsx   (kartu stok: sebelum/sesudah, filter, paging)
// Modal Opname / Penyesuaian dipindah ke AdjustStockModal.tsx tanpa perubahan alur.
//
// State filter & halaman riwayat dipegang di sini (bukan di tab) supaya tidak
// hilang saat pindah tab, dan supaya tombol "Riwayat" di tab Stok Saat Ini bisa
// membuka tab Riwayat langsung terfilter ke produk tersebut.
//
// Akses (tidak berubah dari sebelumnya):
//   - Seluruh modul digate izin Lihat `stok`; tombol opname digate `stok:edit`
//     (migration 031). Yang benar-benar mengikat tetap RLS + cek izin di RPC
//     `adjust_stock`, bukan layar blokir di bawah.
//
// Fase 2: tab "Sesi Opname" (OpnameTab.tsx) — opname berbentuk sesi: hitung/scan
// banyak produk, tinjau selisih, lalu terapkan sekaligus. Tombol "Penyesuaian
// Cepat" di header tetap ada untuk koreksi satu produk tanpa sesi.
//
// Fase 3: tab "Barang Masuk" (BarangMasukTab.tsx), cetak lembar hitung &
// ekspor Excel hasil opname (OpnameSessionDetail), ekspor daftar Stok Saat Ini,
// dan stok awal produk baru yang kini tercatat otomatis sebagai mutasi.

import { useCallback, useState } from "react";
import {
  ClipboardCheck,
  ClipboardList,
  History,
  Package,
  PackagePlus,
  ShieldAlert,
} from "lucide-react";
import {
  useStock,
  useStockActors,
  STOCK_PAGE_SIZE,
  type AdjustStockResult,
  type ManualMovementType,
} from "@/hooks/useStock";
import { useProducts, type ProductWithCategory } from "@/hooks/useProducts";
import { useAuth, hasPermission, hasPermissionAction } from "@/hooks/useAuth";
import AdjustStockModal from "./AdjustStockModal";
import BarangMasukTab from "./BarangMasukTab";
import OpnameTab from "./OpnameTab";
import StokSaatIniTab from "./StokSaatIniTab";
import StokRiwayatTab, {
  EMPTY_RIWAYAT_FILTERS,
  type RiwayatFilters,
} from "./StokRiwayatTab";
import TabSwitcher from "@/app/components/ui/TabSwitcher";
import Button from "@/app/components/ui/Button";

type StokTab = "saat_ini" | "barang_masuk" | "opname" | "riwayat";

const TABS: { key: StokTab; label: string; icon: typeof Package }[] = [
  { key: "saat_ini", label: "Stok Saat Ini", icon: Package },
  { key: "barang_masuk", label: "Barang Masuk", icon: PackagePlus },
  { key: "opname", label: "Sesi Opname", icon: ClipboardList },
  { key: "riwayat", label: "Riwayat Mutasi", icon: History },
];

export default function StokModule() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<StokTab>("saat_ini");
  const [filters, setFilters] = useState<RiwayatFilters>(EMPTY_RIWAYAT_FILTERS);
  const [page, setPage] = useState(0);

  // Modal opname: `product` terisi kalau dibuka dari baris tabel Stok Saat Ini.
  const [modal, setModal] = useState<{
    isOpen: boolean;
    product: ProductWithCategory | null;
  }>({ isOpen: false, product: null });

  const {
    movements,
    totalCount,
    summary,
    isLoading: isMovementsLoading,
    error: movementsError,
    refetch: refetchMovements,
    adjustStock,
  } = useStock({
    productId: filters.productId,
    userId: filters.userId,
    types: filters.types,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    page,
  });

  // User yang pernah membuat mutasi — pilihan filter "Oleh" di tab Riwayat.
  const { actors } = useStockActors();

  // includeInactive: produk nonaktif tetap punya stok fisik di rak dan tetap
  // perlu diopname — beda dengan layar Kasir yang hanya boleh menjual yang aktif.
  const {
    products,
    isLoading: isProductsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useProducts({ includeInactive: true });

  // ── REVISI (migration 028/030) ── izin dinamis "stok", bukan role string.
  const canViewStock = hasPermission(user, "stok");
  // ── (migration 031) ── opname/penyesuaian punya gate sendiri: role bisa saja
  // boleh melihat stok TANPA boleh mengubahnya.
  const canAdjustStock = hasPermissionAction(user, "stok", "edit");

  const handleFiltersChange = (partial: Partial<RiwayatFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
    setPage(0);
  };

  const handleResetFilters = () => {
    setFilters(EMPTY_RIWAYAT_FILTERS);
    setPage(0);
  };

  const openHistoryForProduct = (product: ProductWithCategory) => {
    setFilters({ ...EMPTY_RIWAYAT_FILTERS, productId: product.id });
    setPage(0);
    setActiveTab("riwayat");
  };

  // Setelah opname sukses, kartu stok di-refetch oleh useStock sendiri; daftar
  // Stok Saat Ini perlu di-refetch juga supaya angkanya langsung ikut berubah.
  const handleAdjust = useCallback(
    async (params: {
      productId: string;
      type: ManualMovementType;
      value: number;
      reason: string;
    }): Promise<AdjustStockResult> => {
      const result = await adjustStock(params);
      refetchProducts();
      return result;
    },
    [adjustStock, refetchProducts],
  );

  // Sesi opname selesai / barang masuk dicatat atau dibatalkan = stok banyak
  // produk berubah sekaligus: segarkan daftar Stok Saat Ini dan kartu stok.
  const handleOpnameStockChanged = useCallback(() => {
    refetchProducts();
    refetchMovements();
  }, [refetchProducts, refetchMovements]);

  // ---------------- Layar blokir untuk role tanpa akses ----------------
  if (!isAuthLoading && !canViewStock) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Role Anda tidak punya akses ke menu Stok & Opname. Hubungi admin
          kalau Anda memang perlu melihat atau melakukan opname stok.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 md:p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Alat Kasir
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            Stok & Opname
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Pantau stok setiap produk dan telusuri semua perubahannya —
            penjualan, retur, void, opname, dan penyesuaian manual.
          </p>
        </div>

        {canAdjustStock && (
          <Button
            type="button"
            onClick={() => setModal({ isOpen: true, product: null })}
            size="lg"
          >
            <ClipboardCheck className="h-4 w-4" />
            Penyesuaian Cepat
          </Button>
        )}
      </div>

      {/* Tab switcher — gaya "segmented control" yang sama dengan menu Pengaturan. */}
      <TabSwitcher
        tabs={TABS}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      {activeTab === "saat_ini" && (
        <StokSaatIniTab
          products={products}
          isLoading={isProductsLoading}
          error={productsError}
          canAdjust={canAdjustStock}
          onOpname={(product) => setModal({ isOpen: true, product })}
          onViewHistory={openHistoryForProduct}
        />
      )}

      {activeTab === "barang_masuk" && (
        <BarangMasukTab
          products={products}
          canEdit={canAdjustStock}
          onStockChanged={handleOpnameStockChanged}
        />
      )}

      {activeTab === "opname" && (
        <OpnameTab
          products={products}
          canEdit={canAdjustStock}
          onStockChanged={handleOpnameStockChanged}
        />
      )}

      {activeTab === "riwayat" && (
        <StokRiwayatTab
          movements={movements}
          totalCount={totalCount}
          summary={summary}
          isLoading={isMovementsLoading}
          error={movementsError}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onResetFilters={handleResetFilters}
          page={page}
          pageSize={STOCK_PAGE_SIZE}
          onPageChange={setPage}
          products={products}
          actors={actors}
        />
      )}

      {modal.isOpen && (
        <AdjustStockModal
          products={products}
          initialProduct={modal.product}
          onClose={() => setModal({ isOpen: false, product: null })}
          onSubmit={handleAdjust}
        />
      )}
    </div>
  );
}
