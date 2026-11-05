"use client";

// ── TAMBAHAN ── Modal ini mengisi 2 hal yang di PRD §15.2 masih ditandai belum ada:
// 1. Tombol "Lihat Detail & Cetak" (sebelumnya sengaja `disabled` di TransactionHistoryModule).
// 2. Retur (sebagian) & Void, memakai RPC `return_transaction` / `void_transaction` yang
//    sudah dibuat di migration 004_return_and_void.sql tapi belum pernah dipanggil frontend.
//
// Aturan permission (PRD §5, digeneralisasi migration 030): retur & void butuh
// permission "retur_void" (default: Admin & Supervisor) — tombolnya disembunyikan
// untuk role yang tidak punya, tapi RPC sendiri tetap validasi ulang permission yang
// sama di server (jangan andalkan sembunyi tombol saja sebagai keamanan).
//
// ── PEMECAHAN FILE ── Sebelumnya semua tampilan ada di SATU file ini (±1.116
// baris). Sekarang file ini cuma menyimpan state + handler (muat detail,
// cetak ulang, kirim WA, proses retur/void) dan menyusun komponen di bawah;
// tiap bagian tampilan punya file sendiri di folder ini:
//   transactionDetailUtils.ts  PanelMode, formatDate, methodLabel
//   DetailInfoSection.tsx      tanggal, kasir, pelanggan, alasan void/retur
//   DetailItemsTable.tsx       tabel item (+ kolom qty retur)
//   DetailTotals.tsx           subtotal, total, pembayaran, poin
//   ReturnHistorySection.tsx   peringatan refund + riwayat retur
//   RefundWarnings.tsx         kotak peringatan refund digital/piutang
//   ReturnPanel.tsx            form retur
//   VoidPanel.tsx              form void
//   DetailFooterActions.tsx    tombol cetak ulang / Kirim WA / Retur / Void
// JSX dipindah apa adanya; logika tidak diubah.

import { useEffect, useState } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { useAuth, hasPermissionAction } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings"; // ── TAMBAHAN ── Untuk mendapatkan paperNota setting
import {
  getTransactionDetail,
  returnTransaction,
  voidTransaction,
  type TransactionDetail,
} from "@/lib/pos/transactionApi";
// ── TAMBAHAN (migration 037/039) ── Perkiraan dana kembali & ringkasan retur
// (fungsi murni, diuji terpisah). Angka final tetap dihitung server.
import { estimateReturn, summarizeReturns } from "@/lib/pos/returnPreview";
import {
  printA6Nota,
  shareReceiptViaWhatsApp,
  type ReceiptData,
} from "@/lib/pos/printLogic";
import { getReceiptPromo } from "@/lib/pos/receiptQr";
// ── PERBAIKAN (auto-print munculkan dialog cetak sistem) ── format
// "thermal" sekarang lewat printReceipt() (lihat catatan yang sama di
// KasirModule.tsx) supaya cetak ulang struk thermal juga tidak memunculkan
// dialog cetak kalau printer default kasir bertipe Bluetooth/USB. Format
// "nota" (A6/A5) TETAP pakai printA6Nota() / window.print() — itu memang
// ditujukan untuk printer kertas biasa (bukan thermal ESC/POS), jadi
// dialog cetak sistem di sana bukan bug, melainkan cara satu-satunya.
import { usePrinterProfiles } from "@/hooks/usePrinterProfiles";
import { formatRupiah } from "@/lib/pos/cartLogic";
import Modal from "@/app/components/ui/Modal";
import IconButton from "@/app/components/ui/IconButton";
import DetailInfoSection from "./DetailInfoSection";
import DetailItemsTable from "./DetailItemsTable";
import DetailTotals from "./DetailTotals";
import ReturnHistorySection from "./ReturnHistorySection";
import ReturnPanel from "./ReturnPanel";
import VoidPanel from "./VoidPanel";
import DetailFooterActions from "./DetailFooterActions";
import type { PanelMode } from "./transactionDetailUtils";


interface TransactionDetailModalProps {
  transactionId: string | null;
  onClose: () => void;
  /** Dipanggil setelah retur/void berhasil, supaya parent bisa refetch daftar riwayat. */
  onChanged: () => void;
}

export default function TransactionDetailModal({
  transactionId,
  onClose,
  onChanged,
}: TransactionDetailModalProps) {
  const { user } = useAuth();
  // ── REVISI (migration 030) ── `user?.role` (string admin/supervisor) sudah
  // dihapus sejak migration 028. Gate retur/void sekarang pakai permission
  // dinamis `retur_void` (RPC `void_transaction`/`return_transaction` di
  // migration 030 juga sudah divalidasi ulang pakai has_permission yang sama
  // di server — sembunyikan tombol di sini murni UX, bukan satu-satunya lapis
  // keamanan).
  // ── REVISI (migration 031, "permission granular per aksi") ── Retur & Void
  // dulu SATU flag gabungan (`canManage`), sekarang 2 aksi terpisah pada
  // permission yang sama: Retur = aksi "Tambah" (bikin baris transaksi RETURN
  // baru), Void = aksi "Hapus" (membatalkan keabsahan transaksi) — lihat
  // catatan lengkap soal keputusan ini di header migration 031. Role bisa
  // saja diberi salah satu tanpa yang lain (mis. kasir senior boleh Retur
  // tapi Void cuma untuk supervisor ke atas).
  const canRetur = hasPermissionAction(user, "retur_void", "create");
  const canVoid = hasPermissionAction(user, "retur_void", "delete");
  const { settings: posSettings, outlet } = useSettings();
  const { printReceipt } = usePrinterProfiles();

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<PanelMode>("detail");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [returnQtyById, setReturnQtyById] = useState<Record<string, number>>(
    {},
  );
  const [returnReason, setReturnReason] = useState("");

  const [voidReason, setVoidReason] = useState("");

  const [isPrintDropdownOpen, setIsPrintDropdownOpen] = useState(false);

  // ── TAMBAHAN (T-08 lanjutan) ── Kirim struk digital ke WhatsApp pelanggan.
  // State terpisah dari `isSubmitting` (dipakai retur/void) — supaya klik
  // "Kirim WA" tidak ikut menonaktifkan tombol Retur/Void atau sebaliknya,
  // keduanya independen.
  const [isSharingWa, setIsSharingWa] = useState(false);

  const isOpen = Boolean(transactionId);

  useEffect(() => {
    if (!transactionId) return;

    let isCancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setDetail(null);
    setMode("detail");
    setActionError(null);
    setActionSuccess(null);
    setReturnQtyById({});
    setReturnReason("");
    setVoidReason("");
    setIsPrintDropdownOpen(false);

    getTransactionDetail(transactionId)
      .then((data) => {
        if (isCancelled) return;
        setDetail(data);
      })
      .catch((err) => {
        if (isCancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Gagal memuat detail transaksi.",
        );
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [transactionId]);

  if (!isOpen) return null;

  // ── KOREKSI (T-08 lanjutan) ── Dipisah dari handleReprint() supaya bisa
  // dipakai ulang oleh handleShareWhatsApp() — sebelumnya object ini dibangun
  // inline di dalam handleReprint, sekarang jadi satu sumber kebenaran untuk
  // "apa isi struk transaksi ini", dipakai baik untuk cetak ulang maupun
  // kirim gambar ke WhatsApp.
  function buildReceiptData(txDetail: TransactionDetail): ReceiptData {
    const primaryPayment = txDetail.payments[0];

    return {
      // ── TAMBAHAN ── Sama seperti KasirModule.tsx: sebelumnya tidak dikirim,
      // jadi cetak ulang dari Riwayat Transaksi juga selalu memakai fallback
      // hardcode, bukan Pengaturan Toko yang berlaku SEKARANG. Catatan: kalau
      // Pengaturan Toko diubah SETELAH transaksi lama terjadi, cetak ulang
      // memakai footer/nama toko TERBARU, bukan yang berlaku saat transaksi
      // dibuat — struk tidak menyimpan snapshot data toko per transaksi. Ini
      // konsisten dengan cara `posSettings` dipakai di tempat lain (live,
      // bukan snapshot), tapi sebutkan kalau toko ganti nama/alamat, struk
      // lama yang dicetak ulang akan ikut berubah.
      storeName: posSettings.namaToko,
      storeAddress: posSettings.alamat,
      storePhone: posSettings.telepon,
      footerText: posSettings.footerStruk,
      headerText: outlet.headerStruk || undefined,
      ...getReceiptPromo(posSettings),
      receiptNo: txDetail.receipt_no,
      createdAt: txDetail.created_at,
      cashierName: txDetail.cashier_name,
      customerName: txDetail.customer_name,
      items: txDetail.items.map((item) => ({
        name: item.product_name,
        qty: item.qty,
        price: item.unit_price,
        subtotal: item.subtotal,
      })),
      subtotal: txDetail.subtotal,
      discount: txDetail.discount,
      tax: txDetail.tax,
      total: txDetail.total,
      method: primaryPayment?.method ?? "-",
      paidAmount:
        primaryPayment?.received_amount ??
        primaryPayment?.amount ??
        txDetail.total,
      changeAmount: primaryPayment?.change_amount ?? 0,
      isReprint: true,
    };
  }

  function handleReprint(format: "thermal" | "nota") {
    if (!detail) return;
    setIsPrintDropdownOpen(false);

    const printData = buildReceiptData(detail);

    if (format === "nota") {
      printA6Nota(printData, (posSettings.paperNota as "A6" | "A5") ?? "A6");
    } else {
      void printReceipt(printData);
    }
  }

  // ── TAMBAHAN (T-08 lanjutan) ── Kirim struk digital (gambar JPEG) ke
  // WhatsApp pelanggan, reuse `shareReceiptViaWhatsApp()` (lib/pos/printLogic.ts).
  // `detail.customer_phone` dipakai apa adanya (bisa `null` kalau pelanggan
  // tidak isi no. HP saat transaksi) — `shareReceiptViaWhatsApp()` sendiri
  // sudah menangani kasus itu (fallback `wa.me` TANPA nomor tujuan, membuka
  // layar pilih kontak manual, bukan gagal total).
  async function handleShareWhatsApp() {
    if (!detail) return;
    setIsPrintDropdownOpen(false);
    setActionError(null);
    setActionSuccess(null);
    setIsSharingWa(true);

    try {
      const printData = buildReceiptData(detail);
      const result = await shareReceiptViaWhatsApp(
        printData,
        detail.customer_phone,
      );

      setActionSuccess(
        result.method === "web-share"
          ? "Gambar struk dikirim — pilih WhatsApp di jendela share yang terbuka."
          : "Gambar struk sudah diunduh & WhatsApp dibuka di tab baru — lampirkan gambarnya secara manual (browser ini tidak mendukung lampiran otomatis).",
      );
    } catch (err) {
      // `navigator.share()` melempar `AbortError` kalau pengguna membatalkan
      // sheet share (mis. tekan "Batal") — itu BUKAN kegagalan, jangan
      // ditampilkan sebagai error supaya kasir tidak salah kira ada masalah.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setActionError(
        err instanceof Error
          ? err.message
          : "Gagal membuat/mengirim gambar struk.",
      );
    } finally {
      setIsSharingWa(false);
    }
  }

  async function handleSubmitReturn() {
    if (!detail) return;

    const items = Object.entries(returnQtyById)
      .filter(([, qty]) => qty > 0)
      .map(([transactionItemId, qty]) => ({ transactionItemId, qty }));

    if (items.length === 0) {
      setActionError("Isi minimal 1 qty item yang mau diretur.");
      return;
    }
    if (!returnReason.trim()) {
      setActionError("Alasan retur wajib diisi.");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);

    try {
      const result = await returnTransaction({
        transactionId: detail.id,
        items,
        reason: returnReason,
      });

      // ── PERBAIKAN (037/039) ── Rincian dari server: sebagian refund bisa
      // berupa digital (proses manual) atau bagian piutang (tidak tercatat
      // sebagai kas), dan poin pelanggan ikut disesuaikan.
      const refundParts: string[] = [];
      if (result.refund_cash > 0)
        refundParts.push(`tunai ${formatRupiah(result.refund_cash)}`);
      if (result.refund_digital > 0)
        refundParts.push(
          `digital ${formatRupiah(result.refund_digital)} — proses manual di Midtrans`,
        );
      if (result.refund_not_recorded > 0)
        refundParts.push(
          `${formatRupiah(result.refund_not_recorded)} dari bagian piutang — tagihan tidak otomatis berkurang`,
        );
      const pointParts: string[] = [];
      if (result.points_reversed > 0)
        pointParts.push(`${result.points_reversed} poin dicabut`);
      if (result.points_returned > 0)
        pointParts.push(`${result.points_returned} poin dikembalikan`);

      setActionSuccess(
        `Retur berhasil — ${result.receipt_no}, dana kembali ${formatRupiah(result.refund_amount)}` +
          (refundParts.length > 0 ? ` (${refundParts.join("; ")})` : "") +
          "." +
          (pointParts.length > 0
            ? ` Poin pelanggan: ${pointParts.join(", ")}.`
            : ""),
      );
      onChanged();

      const refreshed = await getTransactionDetail(detail.id);
      setDetail(refreshed);
      setMode("detail");
      setReturnQtyById({});
      setReturnReason("");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Retur gagal diproses.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitVoid() {
    if (!detail) return;

    if (!voidReason.trim()) {
      setActionError("Alasan void wajib diisi.");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);

    try {
      await voidTransaction({ transactionId: detail.id, reason: voidReason });

      setActionSuccess("Transaksi berhasil dibatalkan (void).");
      onChanged();

      const refreshed = await getTransactionDetail(detail.id);
      setDetail(refreshed);
      setMode("detail");
      setVoidReason("");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Void gagal diproses.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── PERBAIKAN (037) ── Dulu `canStillAct = status === "PAID"`. Setelah retur
  // PERTAMA status transaksi berubah jadi RETURN, sehingga tombol Retur hilang
  // padahal server (migration 037) sudah mengizinkan retur sebagian berulang.
  // Sekarang: transaksi PENJUALAN (bukan baris retur) berstatus PAID atau
  // RETURN, selama masih ada qty yang bisa diretur. Void tetap hanya untuk
  // PAID (void_transaction menolak status lain).
  const isReturnRow = Boolean(detail?.related_transaction_id);
  const hasReturnableQty = detail
    ? detail.items.some((item) => item.qty - item.returned_qty > 0)
    : false;
  const canStillReturn =
    Boolean(detail) &&
    !isReturnRow &&
    (detail?.status === "PAID" || detail?.status === "RETURN") &&
    hasReturnableQty;
  const canStillVoid = detail?.status === "PAID";

  // Defensif: kalau lib/pos/transactionApi.ts di proyek belum versi terbaru
  // (belum mengirim `returns`), modal tetap tampil — hanya tanpa riwayat retur —
  // dan tidak crash dengan "Cannot read properties of undefined".
  const returnList = detail?.returns ?? [];
  const returnsSummary = detail
    ? summarizeReturns(
        returnList.map((r) => ({
          refundAmount: r.refund_amount,
          payments: r.payments,
        })),
      )
    : null;
  const digitalRefs = detail
    ? detail.payments
        .filter((p) => p.method === "DIGITAL" && p.reference_no)
        .map((p) => p.reference_no as string)
    : [];
  const tempoPayments = detail
    ? detail.payments.filter((p) => p.method === "TEMPO")
    : [];
  const tempoSettled =
    tempoPayments.length > 0
      ? tempoPayments.every((p) => p.is_settled)
      : undefined;
  // Untuk baris retur: bagian piutang = nilai refund dikurangi refund yang tercatat.
  const returnRowSummary =
    detail && isReturnRow
      ? summarizeReturns([
          { refundAmount: detail.subtotal, payments: detail.payments },
        ])
      : null;

  const returnEstimate =
    detail && mode === "retur"
      ? estimateReturn({
          items: detail.items,
          qtyById: returnQtyById,
          saleSubtotal: detail.subtotal,
          saleTotal: detail.total,
          payments: detail.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
          })),
          previouslyRefunded: returnsSummary?.refundTotal ?? 0,
        })
      : null;

  function statusBadge(d: TransactionDetail): { label: string; cls: string } {
    if (d.status === "VOID")
      return {
        label: "Dibatalkan (void)",
        cls: "bg-lco-coral/10 text-lco-coral border-lco-coral/30",
      };
    if (d.status === "RETURN") {
      if (d.related_transaction_id)
        return {
          label: "Retur",
          cls: "bg-lco-mustard/10 text-lco-mustard border-lco-mustard/40",
        };
      return {
        label: hasReturnableQty ? "Diretur sebagian" : "Diretur seluruhnya",
        cls: "bg-lco-mustard/10 text-lco-mustard border-lco-mustard/40",
      };
    }
    return {
      label: "Selesai",
      cls: "bg-lco-teal/10 text-lco-teal border-lco-teal/30",
    };
  }
  // Pindah ke panel retur/void: bersihkan pesan lama dan tutup dropdown cetak.
  function startMode(next: "retur" | "void") {
    setActionError(null);
    setActionSuccess(null);
    setMode(next);
    setIsPrintDropdownOpen(false);
  }

  return (
    <Modal
      size="xl"
      padding="none"
      layout="flex"
    >
      <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            Riwayat Transaksi
          </p>
          <div className="flex items-center gap-2">
            <h2 className="font-mono font-semibold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
              {detail?.receipt_no ?? "Memuat..."}
            </h2>
            {detail && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(detail).cls}`}
              >
                {statusBadge(detail).label}
              </span>
            )}
          </div>
        </div>
        <IconButton
          onClick={onClose}
          aria-label="Tutup"
          variant="soft"
        >
          <X className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading && (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat detail transaksi...
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-4 text-sm text-lco-coral">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{loadError}</p>
          </div>
        )}

        {detail && !isLoading && (
          <div className="space-y-5">
            <DetailInfoSection detail={detail} isReturnRow={isReturnRow} />

            <DetailItemsTable
              detail={detail}
              mode={mode}
              returnQtyById={returnQtyById}
              onReturnQtyChange={(itemId, qty) =>
                setReturnQtyById((prev) => ({ ...prev, [itemId]: qty }))
              }
            />

            <DetailTotals detail={detail} isReturnRow={isReturnRow} />

            {/* ── TAMBAHAN (037) ── Peringatan + riwayat retur */}
            <ReturnHistorySection
              isReturnRow={isReturnRow}
              returnRowSummary={returnRowSummary}
              returnList={returnList}
              returnsSummary={returnsSummary}
              digitalRefs={digitalRefs}
              tempoSettled={tempoSettled}
            />

            {actionSuccess && (
              <div className="rounded-md border border-lco-teal/30 bg-lco-teal/10 p-3 text-xs text-lco-teal">
                {actionSuccess}
              </div>
            )}
            {actionError && (
              <div className="flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{actionError}</p>
              </div>
            )}

            {mode === "retur" && (
              <ReturnPanel
                detail={detail}
                returnEstimate={returnEstimate}
                returnReason={returnReason}
                onReasonChange={setReturnReason}
                isSubmitting={isSubmitting}
                onCancel={() => setMode("detail")}
                onSubmit={handleSubmitReturn}
              />
            )}

            {mode === "void" && (
              <VoidPanel
                voidReason={voidReason}
                onReasonChange={setVoidReason}
                isSubmitting={isSubmitting}
                onCancel={() => setMode("detail")}
                onSubmit={handleSubmitVoid}
              />
            )}
          </div>
        )}
      </div>

      {detail && mode === "detail" && (
        <DetailFooterActions
          isPrintDropdownOpen={isPrintDropdownOpen}
          onTogglePrintDropdown={() => setIsPrintDropdownOpen(!isPrintDropdownOpen)}
          onReprint={handleReprint}
          isSharingWa={isSharingWa}
          onShareWhatsApp={handleShareWhatsApp}
          showReturButton={canRetur && canStillReturn}
          onStartRetur={() => startMode("retur")}
          showVoidButton={canVoid && canStillVoid}
          onStartVoid={() => startMode("void")}
        />
      )}
    </Modal>
  );
}
