"use client";

// app/components/sampah/SampahModule.tsx
// ── TAMBAHAN ── Modul Sampah (PRD §17 T-09, §4.1 menu LAINNYA → "Sampah").
// Admin+supervisor (PRD §5 baris `trash` aslinya cuma ✔ di kolom Admin —
// dilonggarkan ke supervisor lewat keputusan sadar pemilik project, migration
// 015; lihat komentar header migration itu untuk alasan & konsekuensinya)
// — halaman ini SENGAJA tidak menyembunyikan diri sendiri kalau bukan
// admin/supervisor (itu tanggung jawab routing di app/page.tsx & Sidebar,
// sama seperti modul lain di project ini), tapi setiap aksi Pulihkan tetap
// aman kalau nekat diakses role lain: RPC `restore_product`/
// `restore_transaction` (migration 014, diperbarui migration 015) menolak
// dari sisi database, errornya ditampilkan apa adanya lewat state
// `actionError` di bawah.
//
// Tab "Produk" & "Transaksi" — pola sama dengan tab internal di
// ProdukModule.tsx (Daftar Produk/Kategori) & TransactionHistoryModule.tsx
// (filter status), bukan komponen tab generik terpisah.

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpFromLine,
  Loader2,
  Package,
  Receipt,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useAuth, hasPermission, hasPermissionAction } from "@/hooks/useAuth";
import {
  useTrash,
  type TrashedProduct,
  type TrashedTransaction,
} from "@/hooks/useTrash";
import { formatRupiah } from "@/lib/pos/cartLogic";
import TabSwitcher from "@/app/components/ui/TabSwitcher";
import Button from "@/app/components/ui/Button";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";

type SampahTab = "produk" | "transaksi";

// Target konfirmasi hapus permanen: satu baris, atau semua isi tab aktif.
type PurgeTarget =
  | { kind: "product"; item: TrashedProduct }
  | { kind: "transaction"; item: TrashedTransaction }
  | { kind: "all-products" }
  | { kind: "all-transactions" };

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

const STATUS_LABEL: Record<TrashedTransaction["status"], string> = {
  PAID: "Selesai",
  VOID: "Void",
  RETURN: "Retur",
};

export default function SampahModule() {
  const { user, isLoading: isAuthLoading } = useAuth();
  // ── REVISI (migration 028/030) ── `user?.role` (string admin/supervisor)
  // sudah dihapus, diganti permission dinamis "sampah" (default masih
  // admin+supervisor lewat seed role_permissions migration 028, keputusan
  // migration 015 tetap terjaga — lihat komentar header migration 015 untuk
  // konteks kenapa admin+supervisor, bukan admin only).
  const canAccessTrash = hasPermission(user, "sampah");
  // Hapus permanen = aksi "Hapus" menu Sampah, terpisah dari Pulihkan ("Ubah").
  const canPurge = hasPermissionAction(user, "sampah", "delete");

  const {
    products,
    transactions,
    isLoading,
    error,
    restoreProduct,
    restoreTransaction,
    permanentDeleteProduct,
    permanentDeleteTransaction,
  } = useTrash();

  const [activeTab, setActiveTab] = useState<SampahTab>("produk");

  // Baris yang sedang diproses restore-nya — dikunci per-id (bukan satu
  // boolean global) supaya klik "Pulihkan" di baris lain tetap responsif
  // selagi satu baris lain masih diproses.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Konfirmasi hapus permanen — aksi ini TIDAK bisa dibatalkan, jadi selalu
  // lewat modal, tidak pernah langsung dari klik tombol.
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const isEmpty = useMemo(
    () =>
      activeTab === "produk"
        ? products.length === 0
        : transactions.length === 0,
    [activeTab, products.length, transactions.length],
  );

  async function handleRestoreProduct(product: TrashedProduct) {
    setActionError(null);
    setRestoringId(product.id);

    try {
      await restoreProduct(product.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Produk gagal dipulihkan.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  async function handleRestoreTransaction(transaction: TrashedTransaction) {
    setActionError(null);
    setRestoringId(transaction.id);

    try {
      await restoreTransaction(transaction.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Transaksi gagal dipulihkan.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  function openPurge(target: PurgeTarget) {
    setPurgeError(null);
    setPurgeTarget(target);
  }

  function closePurge() {
    if (isPurging) return;
    setPurgeTarget(null);
    setPurgeError(null);
  }

  async function handleConfirmPurge() {
    if (!purgeTarget) return;

    setIsPurging(true);
    setPurgeError(null);

    // Hapus berurutan (bukan paralel) supaya kalau ada yang gagal, berhenti
    // di situ dan pesan errornya jelas — yang sudah terhapus tetap terhapus.
    let deleted = 0;

    try {
      if (purgeTarget.kind === "product") {
        await permanentDeleteProduct(purgeTarget.item.id);
      } else if (purgeTarget.kind === "transaction") {
        await permanentDeleteTransaction(purgeTarget.item.id);
      } else if (purgeTarget.kind === "all-products") {
        for (const product of products) {
          await permanentDeleteProduct(product.id);
          deleted += 1;
        }
      } else {
        for (const transaction of transactions) {
          await permanentDeleteTransaction(transaction.id);
          deleted += 1;
        }
      }

      setPurgeTarget(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal menghapus permanen.";
      setPurgeError(
        deleted > 0
          ? `${deleted} data sudah terhapus, lalu berhenti karena: ${message}`
          : message,
      );
    } finally {
      setIsPurging(false);
    }
  }

  function purgeDescription(target: PurgeTarget): string {
    switch (target.kind) {
      case "product":
        return `Produk "${target.item.name}" (${target.item.sku}) akan dihapus permanen dari database. Riwayat penjualan yang memuat produk ini tetap ada, tetapi tidak lagi terhubung ke produk.`;
      case "transaction":
        return `Transaksi ${target.item.receipt_no} beserta item dan pembayarannya akan dihapus permanen dari database. Stok dan poin pelanggan tidak berubah.`;
      case "all-products":
        return `Semua ${products.length} produk di Sampah akan dihapus permanen dari database. Riwayat penjualan yang memuat produk-produk ini tetap ada, tetapi tidak lagi terhubung ke produk.`;
      case "all-transactions":
        return `Semua ${transactions.length} transaksi di Sampah akan dihapus permanen dari database beserta item dan pembayarannya. Stok dan poin pelanggan tidak berubah.`;
    }
  }

  // Halaman Sampah admin-only (PRD §5 baris `trash`) — pola sama seperti
  // LaporanModule.tsx: menu tetap tampil di Sidebar untuk semua role (lihat
  // Sidebar.tsx), yang menahan akses justru layar blokir ini. Ditaruh
  // SETELAH semua hook dipanggil (bukan early-return di awal fungsi) supaya
  // urutan pemanggilan hook tetap konsisten antar render — aturan dasar
  // Rules of Hooks.
  //
  // ── PERBAIKAN ── Selama `isAuthLoading` masih true, dulu kode ini jatuh
  // ke `return` konten utama di bawah (kondisi `!isAuthLoading && !canAccessTrash`
  // otomatis false saat isAuthLoading true) — jadi header+tab+tabel sempat
  // dirender dulu, baru begitu auth selesai dimuat & ternyata bukan admin,
  // seluruh halaman diganti jadi layar blokir. Itu penyebab "kedipan" yang
  // dilaporkan. Sekarang loading auth punya cabangnya sendiri, TIDAK
  // dianggap sama dengan "izinnya belum diketahui" lalu lanjut render konten.
  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!canAccessTrash) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-100 p-6 text-center dark:bg-zinc-950">
        <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <ShieldAlert className="h-6 w-6 text-lco-coral" />
        </div>
        <h3 className="text-sm font-semibold">Akses Ditolak</h3>
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Modul Sampah hanya untuk admin dan supervisor. Hubungi admin kalau ada
          produk atau transaksi yang perlu dipulihkan.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-100 p-4 dark:bg-zinc-950 md:p-6">
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Administrasi
        </p>

        <h2 className="text-2xl font-semibold tracking-tight">Sampah</h2>

        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Produk & transaksi yang dihapus tetap tersimpan di sini dan bisa
          dipulihkan kapan saja.
          {canPurge &&
            " Gunakan Hapus Permanen untuk membersihkannya dari database — tidak bisa dibatalkan."}
        </p>
      </div>

      {/* Tab switcher — gaya "segmented control" yang sama dengan Stok & Opname dan Pengaturan. */}
      <TabSwitcher
        tabs={[
          {
            key: "produk",
            label: `Produk (${products.length})`,
            icon: Package,
          },
          {
            key: "transaksi",
            label: `Transaksi (${transactions.length})`,
            icon: Receipt,
          },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      {error && (
        <div className="mb-4 flex items-start gap-3 border border-lco-coral/30 bg-white p-4 text-sm text-lco-coral dark:bg-zinc-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

          <div>
            <p className="font-medium">Gagal memuat Sampah</p>
            <p className="mt-1 break-all text-xs opacity-80">{error}</p>
          </div>
        </div>
      )}

      {actionError && (
        <div className="mb-4 flex items-start gap-3 border border-lco-coral/30 bg-white p-4 text-sm text-lco-coral dark:bg-zinc-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{actionError}</p>
        </div>
      )}

      {canPurge && !isLoading && !isEmpty && (
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            variant="outline-danger"
            size="sm"
            onClick={() =>
              openPurge({
                kind:
                  activeTab === "produk" ? "all-products" : "all-transactions",
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            {activeTab === "produk"
              ? "Kosongkan Sampah Produk"
              : "Kosongkan Sampah Transaksi"}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <div className="flex min-h-64 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat Sampah...
            </div>
          </div>
        ) : isEmpty ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <Trash2 className="h-6 w-6 text-zinc-400" />
            </div>

            <h3 className="text-sm font-semibold">Sampah kosong</h3>

            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {activeTab === "produk"
                ? "Belum ada produk yang dihapus."
                : "Belum ada transaksi yang dihapus."}
            </p>
          </div>
        ) : activeTab === "produk" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Produk
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Harga Jual
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Stok
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Dihapus
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Aksi
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                          {product.photo_url ? (
                            <img
                              src={product.photo_url}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Package className="h-4 w-4 text-zinc-400" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.name}</p>
                          <p className="mt-0.5 font-mono text-xs tabular-nums text-zinc-400">
                            {product.sku}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatRupiah(product.sell_price)}
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {product.type === "JASA" ? "∞" : product.stock}
                    </td>

                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {formatDateTime(product.deleted_at)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          onClick={() => handleRestoreProduct(product)}
                          disabled={restoringId === product.id}
                          variant="secondary"
                          size="sm"
                        >
                          {restoringId === product.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Pulihkan
                        </Button>

                        {canPurge && (
                          <Button
                            type="button"
                            onClick={() =>
                              openPurge({ kind: "product", item: product })
                            }
                            disabled={restoringId === product.id}
                            variant="outline-danger"
                            size="sm"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus Permanen
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    No. Struk
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Pelanggan
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Total
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Dihapus
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Aksi
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="transition-colors duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        <span className="font-mono text-xs tabular-nums">
                          {transaction.receipt_no}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {transaction.customer_name || "—"}
                    </td>

                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {STATUS_LABEL[transaction.status]}
                    </td>

                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatRupiah(transaction.total)}
                    </td>

                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {formatDateTime(transaction.deleted_at)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          onClick={() => handleRestoreTransaction(transaction)}
                          disabled={restoringId === transaction.id}
                          variant="secondary"
                          size="sm"
                        >
                          {restoringId === transaction.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowUpFromLine className="h-3.5 w-3.5" />
                          )}
                          Pulihkan
                        </Button>

                        {canPurge && (
                          <Button
                            type="button"
                            onClick={() =>
                              openPurge({
                                kind: "transaction",
                                item: transaction,
                              })
                            }
                            disabled={restoringId === transaction.id}
                            variant="outline-danger"
                            size="sm"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Hapus Permanen
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {purgeTarget && (
        <Modal size="md" aria-label="Konfirmasi hapus permanen">
          <ModalHeader
            title="Hapus Permanen?"
            icon={<TriangleAlert className="h-4 w-4 text-lco-coral" />}
            onClose={closePurge}
            closeDisabled={isPurging}
          />

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {purgeDescription(purgeTarget)}
          </p>

          <p className="mt-3 text-sm font-medium text-lco-coral">
            Tindakan ini tidak bisa dibatalkan dan datanya tidak bisa dipulihkan
            lagi.
          </p>

          {purgeError && (
            <div className="mt-4 flex items-start gap-2 border border-lco-coral/30 bg-white p-3 text-sm text-lco-coral dark:bg-zinc-950">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{purgeError}</p>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={closePurge}
              disabled={isPurging}
            >
              Batal
            </Button>

            <Button
              type="button"
              variant="danger"
              className="flex-1"
              onClick={handleConfirmPurge}
              disabled={isPurging}
            >
              {isPurging ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Hapus Permanen
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
