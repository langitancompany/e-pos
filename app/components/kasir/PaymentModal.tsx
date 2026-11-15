"use client";

import { useState, useEffect, useRef } from "react";
import { X, CheckCircle2, AlertTriangle } from "lucide-react";
import type {
  CreatedPayment,
  PaymentMethod,
  SplitPaymentLine,
} from "@/lib/pos/transactionApi";
import { validateSplitPayments } from "@/lib/pos/transactionApi";
// ── PERBAIKAN (konsep baru: preview struk + cetak manual) ── Sebelumnya di
// sini ada tipe `ReceiptPreviewData` yang didefinisikan ULANG secara manual
// (supaya PaymentModal "tidak perlu tahu" bentuk printLogic.ts) — tapi itu
// bikin field-nya gampang tidak sinkron dengan `ReceiptData` yang sebenarnya
// (sudah 2x ketahuan beda: `customerName`, lalu `discount`). Sekarang pakai
// TYPE-ONLY import langsung dari printLogic.ts: baris `import type` di bawah
// ini dihapus total oleh compiler saat build (tidak ada kode printLogic.ts
// yang ikut ter-bundle/dijalankan di sini), jadi PaymentModal tetap tidak
// punya dependency RUNTIME ke modul cetak — cuma dependency TIPE, supaya
// TypeScript selalu tahu bentuk data struk yang benar tanpa perlu disalin
// manual lagi.
import type { ReceiptData } from "@/lib/pos/printLogic";
// ── TAMBAHAN (Midtrans, langkah 7) ── Helper pembayaran digital (sisi browser).
// Tidak memegang kunci rahasia — lihat lib/midtrans/client.ts.
import {
  cancelMidtransOrder,
  closeSnapPopup,
  createMidtransOrder,
  getMidtransStatus,
  isAbortError,
  openSnapPopup,
  waitForMidtransResult,
  type MidtransOrder,
  type MidtransStatusResult,
} from "@/lib/midtrans/client";
import Modal from "@/app/components/ui/Modal";
import IconButton from "@/app/components/ui/IconButton";
import PaymentSuccessView from "./PaymentSuccessView";
import PaymentSummaryCard from "./PaymentSummaryCard";
import PaymentModeSwitch from "./PaymentModeSwitch";
import SinglePaymentForm from "./SinglePaymentForm";
import SplitPaymentForm from "./SplitPaymentForm";
import DigitalPaymentPanel from "./DigitalPaymentPanel";
import PaymentFooter from "./PaymentFooter";
import {
  METHODS,
  SPLIT_ORDER,
  DigitalCancelledError,
  defaultDueDate,
  emptyMethodAmounts,
  emptyMethodFlags,
  formatRp,
} from "./paymentUtils";
// ── PEMECAHAN FILE ── Sebelumnya semua tampilan + logika ada di SATU file ini
// (±1.707 baris). Sekarang file ini menyimpan state, efek, dan handler
// pembayaran (termasuk alur Midtrans) lalu menyusun komponen di bawah; tiap
// bagian tampilan punya file sendiri di folder ini:
//   paymentUtils.ts          konstanta & helper murni (METHODS, formatRp, dst.)
//   PaymentSuccessView.tsx   layar "Pembayaran Berhasil"
//   ReceiptPreview.tsx       preview struk di layar sukses
//   PaymentSummaryCard.tsx   kartu total tagihan
//   PaymentModeSwitch.tsx    pemilih Satu Metode / Split Bayar
//   SinglePaymentForm.tsx    form Tunai / Digital / Piutang
//   SplitPaymentForm.tsx     form split bayar
//   DigitalPaymentPanel.tsx  panel menunggu pembayaran Midtrans
//   PaymentFooter.tsx        tombol proses pembayaran
// JSX & logika dipindah apa adanya; tidak ada perubahan perilaku.


type PaymentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /**
   * ── TAMBAHAN (menu Pelanggan) ── Pelanggan yang sudah dipilih di layar
   * Kasir (kolom "Pelanggan [F2]"). Nama & no. HP-nya DIISIKAN OTOMATIS ke
   * form di bawah saat modal dibuka — kasir tetap bisa mengubahnya. Kalau
   * tidak ada pelanggan terpilih, form kosong: kasir boleh membiarkannya,
   * atau mengisi nama/no. HP untuk mendaftarkan member baru sekaligus
   * (didaftarkan oleh KasirModule setelah pembayaran berhasil).
   */
  initialCustomerName?: string;
  initialCustomerPhone?: string;
  subtotal: number;
  tax: number;
  total: number;
  onConfirmPayment: (
    method: PaymentMethod,
    paidAmount: number,
    change: number,
    extra?: {
      customerName?: string;
      /** ── TAMBAHAN (013) ── Nomor HP pelanggan, opsional untuk semua metode. */
      customerPhone?: string;
      dueDate?: string;
      /**
       * ── TAMBAHAN (Midtrans) ── Order ID Midtrans yang SUDAH LUNAS untuk
       * metode Digital. Diisi PaymentModal setelah pembayaran terkonfirmasi;
       * parent meneruskannya ke createTransaction({ digitalOrderId }).
       */
      digitalOrderId?: string;
    },
  ) => Promise<{ paymentId: string }>;
  /**
   * ── TAMBAHAN (021, T-11 bagian 2) ── Simpan transaksi dengan SPLIT payment
   * (beberapa metode sekaligus). Opsional: kalau parent tidak mengirim prop ini,
   * pilihan "Split Bayar" disembunyikan dan modal berperilaku persis seperti
   * sebelumnya. Hasilnya memuat `payments` (id tiap baris pembayaran yang baru
   * tersimpan).
   */
  onConfirmSplitPayment?: (
    lines: SplitPaymentLine[],
    extra?: {
      customerName?: string;
      customerPhone?: string;
      /** ── TAMBAHAN (Midtrans) ── Order ID lunas untuk baris DIGITAL di split. */
      digitalOrderId?: string;
    },
  ) => Promise<{ payments: CreatedPayment[] }>;
  /**
   * ── TAMBAHAN (013) ── Kirim struk digital ke WhatsApp pelanggan (PRD §4.2
   * "kirim struk via WhatsApp", §4.7). Dipanggil dari tombol di layar sukses,
   * SETELAH transaksi tersimpan (parent — KasirModule — yang tahu data
   * lengkap struk & memanggil shareReceiptViaWhatsApp() dari printLogic.ts;
   * PaymentModal sengaja tidak import printLogic sendiri supaya modal ini
   * tetap murni UI pembayaran, tidak perlu tahu bentuk ReceiptData).
   * Opsional — kalau tidak dikirim parent, tombol "Kirim WA" disembunyikan.
   */
  onSendWhatsApp?: () => Promise<{ method: "web-share" | "download-fallback" }>;
  /**
   * ── TAMBAHAN (konsep baru: preview struk + cetak manual) ── Data struk
   * transaksi yang baru saja sukses, untuk ditampilkan sebagai PREVIEW di
   * sebelah layar sukses. null/undefined selama belum ada transaksi sukses
   * (tidak akan terjadi di praktik — parent selalu mengisinya sebelum
   * onConfirmPayment/onConfirmSplitPayment resolve, lihat KasirModule.tsx).
   */
  receipt?: ReceiptData | null;
  /**
   * ── PERBAIKAN (auto-print setelah bayar) ── Dipanggil OTOMATIS, sekali,
   * tepat saat layar sukses pertama kali muncul — kasir TIDAK perlu menekan
   * tombol apa pun lagi untuk mencetak. Parent (KasirModule) selalu mencetak
   * ke printer thermal lewat callback ini; pemilihan format thermal/nota
   * sekarang hanya ada di alur "Cetak Ulang" pada Riwayat Transaksi.
   * Opsional: kalau parent tidak mengirim prop ini, tidak ada auto-print
   * ataupun notif "Struk berhasil dicetak" yang muncul.
   */
  onPrint?: () => void;
  /** Tampilkan metode Digital (Midtrans). Default false = hanya Tunai & Piutang. */
  digitalEnabled?: boolean;
};

export default function PaymentModal({
  isOpen,
  onClose,
  initialCustomerName = "",
  initialCustomerPhone = "",
  subtotal,
  tax,
  total,
  onConfirmPayment,
  onConfirmSplitPayment,
  onSendWhatsApp,
  receipt,
  onPrint,
  digitalEnabled = false,
}: PaymentModalProps) {
  // Daftar metode yang boleh dipilih; DIGITAL hanya kalau diaktifkan di Pengaturan.
  const availableMethods = digitalEnabled
    ? METHODS
    : METHODS.filter((m) => m.value !== "DIGITAL");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [paidAmount, setPaidAmount] = useState<number>(0);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());

  // ── TAMBAHAN (021) ── State mode split. Sengaja terpisah dari `method`/`paidAmount`
  // milik mode tunggal supaya berpindah mode tidak saling menimpa input kasir.
  // - splitOn: metode mana yang dipakai (tiap metode maksimal 1 baris, sama seperti RPC).
  // - splitAmount: nominal yang DIKETIK kasir per metode. TEMPO tidak ikut —
  //   nominal TEMPO selalu otomatis = sisa (lihat `tempoAmount` di bawah), supaya
  //   piutang tidak bisa salah ketik.
  // - splitCashReceived: uang yang diserahkan untuk porsi tunai (0/kosong = uang pas).
  const [mode, setMode] = useState<"single" | "split">("single");
  const [splitOn, setSplitOn] =
    useState<Record<PaymentMethod, boolean>>(emptyMethodFlags());
  const [splitAmount, setSplitAmount] =
    useState<Record<PaymentMethod, number>>(emptyMethodAmounts());
  const [splitCashReceived, setSplitCashReceived] = useState<number>(0);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // ── TAMBAHAN (Midtrans, langkah 7) ── State pembayaran digital.
  // - digitalPhase: "creating" = meminta token ke server; "waiting" = popup
  //   Snap dibuka & polling status berjalan; "idle" = tidak ada proses digital.
  // - digitalOrder: order Midtrans yang sedang ditunggu (untuk panel status).
  // - paidDigital: pembayaran digital SUDAH LUNAS tapi transaksi POS belum
  //   tersimpan. Selama terisi, percobaan simpan berikutnya memakai order yang
  //   sama dan TIDAK menagih pelanggan lagi; form dikunci supaya nominalnya
  //   tidak bisa diubah.
  const [digitalPhase, setDigitalPhase] = useState<
    "idle" | "creating" | "waiting"
  >("idle");
  const [digitalOrder, setDigitalOrder] = useState<MidtransOrder | null>(null);
  const [paidDigital, setPaidDigital] = useState<{
    orderId: string;
    amount: number;
  } | null>(null);
  const [digitalNote, setDigitalNote] = useState<string | null>(null);
  const [digitalMidtransStatus, setDigitalMidtransStatus] = useState<
    string | null
  >(null);
  const [checkingDigital, setCheckingDigital] = useState(false);
  const [cancellingDigital, setCancellingDigital] = useState(false);
  // Ref untuk nilai yang dibaca dari callback async / tombol saat polling
  // berjalan (state di closure bisa basi).
  const digitalOrderRef = useRef<MidtransOrder | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const cancelResultRef = useRef<MidtransStatusResult | null>(null);

  // ── TAMBAHAN (013) ── Status tombol "Kirim WA" di layar sukses. Terpisah dari
  // isProcessing karena aksi ini terjadi SETELAH transaksi
  // sudah tersimpan — gagal di sini tidak boleh terlihat seperti transaksi
  // gagal (uang & stok sudah benar, cuma pengiriman gambar struk yang gagal).
  const [waStatus, setWaStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [waMethod, setWaMethod] = useState<
    "web-share" | "download-fallback" | null
  >(null);
  const [waError, setWaError] = useState<string | null>(null);

  // ── PERBAIKAN (auto-print setelah bayar) ── `autoPrintedRef` mencegah
  // `onPrint()` terpanggil lebih dari sekali untuk satu transaksi sukses yang
  // sama (mis. kalau komponen re-render selagi isSuccess masih true — lihat
  // efek di bawah). Pakai ref (bukan state) karena nilainya tidak boleh
  // memicu render ulang sendiri, hanya dibaca di dalam efek.
  const autoPrintedRef = useRef(false);
  // Notif pop-up "Struk berhasil dicetak" — muncul tepat saat auto-print
  // terpicu, hilang otomatis lewat timeout di bawah (Toast.tsx sendiri cuma
  // urusan tampilan, tidak menyimpan timer-nya sendiri).
  const [printToastVisible, setPrintToastVisible] = useState(false);
  const printToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const PRINT_TOAST_DURATION_MS = 3000;

  useEffect(() => {
    if (isOpen) {
      setMethod("CASH");
      setPaidAmount(0);
      // ── TAMBAHAN (menu Pelanggan) ── Isi dari pelanggan yang dipilih di
      // Kasir (kosong kalau tidak ada). Dibaca hanya saat modal DIBUKA —
      // makanya deps efek ini sengaja tetap [isOpen] saja.
      setCustomerName(initialCustomerName);
      setCustomerPhone(initialCustomerPhone);
      setDueDate(defaultDueDate());
      setMode("single");
      setSplitOn(emptyMethodFlags());
      setSplitAmount(emptyMethodAmounts());
      setSplitCashReceived(0);
      setIsProcessing(false);
      setIsSuccess(false);
      setLocalError(null);
      setWaStatus("idle");
      setWaMethod(null);
      setWaError(null);
      // ── TAMBAHAN (Midtrans) ── Bersihkan sisa pembayaran digital sebelumnya.
      pollAbortRef.current?.abort();
      digitalOrderRef.current = null;
      cancelResultRef.current = null;
      setDigitalPhase("idle");
      setDigitalOrder(null);
      setPaidDigital(null);
      setDigitalNote(null);
      setDigitalMidtransStatus(null);
      setCheckingDigital(false);
      setCancellingDigital(false);
      autoPrintedRef.current = false;
      if (printToastTimeoutRef.current) {
        clearTimeout(printToastTimeoutRef.current);
        printToastTimeoutRef.current = null;
      }
      setPrintToastVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── PERBAIKAN (auto-print setelah bayar) ── Begitu layar sukses muncul
  // (isSuccess true), langsung cetak struk sekali ke printer thermal tanpa
  // kasir perlu menekan tombol apa pun, lalu tampilkan notif pop-up "Struk
  // berhasil dicetak" selama PRINT_TOAST_DURATION_MS. Dijaga `autoPrintedRef`
  // supaya tidak tercetak berkali-kali kalau komponen re-render selagi masih
  // di layar sukses yang sama.
  useEffect(() => {
    if (!isOpen || !isSuccess || !onPrint || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    onPrint();
    setPrintToastVisible(true);
    if (printToastTimeoutRef.current)
      clearTimeout(printToastTimeoutRef.current);
    printToastTimeoutRef.current = setTimeout(() => {
      setPrintToastVisible(false);
    }, PRINT_TOAST_DURATION_MS);
  }, [isOpen, isSuccess, onPrint]);

  // Bersihkan timer toast kalau komponen unmount selagi toast masih berjalan.
  useEffect(() => {
    return () => {
      if (printToastTimeoutRef.current)
        clearTimeout(printToastTimeoutRef.current);
    };
  }, []);

  // ── TAMBAHAN (Midtrans) ── Hentikan polling & tutup popup Snap kalau
  // komponen dilepas (mis. pindah halaman) supaya tidak ada loop yatim.
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
      closeSnapPopup();
    };
  }, []);

  if (!isOpen) return null;

  const changeAmount = paidAmount - total;

  // ── TAMBAHAN (021) ── Turunan mode split. Semua dihitung ulang tiap render dari
  // state di atas (murni, tanpa efek samping) — tidak ada state turunan yang bisa
  // basi/tidak sinkron dengan input kasir.
  const splitAvailable = !!onConfirmSplitPayment && total > 0;
  const isSplit = mode === "split" && splitAvailable;
  const selectedMethods = SPLIT_ORDER.filter((m) => splitOn[m]);
  const typedSum = selectedMethods
    .filter((m) => m !== "TEMPO")
    .reduce((sum, m) => sum + (splitAmount[m] || 0), 0);
  // Sisa tagihan setelah semua nominal yang diketik. Kalau TEMPO dipilih,
  // nilai inilah yang menjadi piutang; kalau tidak, sisa harus 0.
  const splitRemaining = total - typedSum;
  const tempoAmount = splitOn.TEMPO ? Math.max(splitRemaining, 0) : 0;
  const splitPaidSum = typedSum + tempoAmount;
  // Uang tunai diterima kosong (0) dianggap uang pas.
  const cashReceivedEffective =
    splitCashReceived > 0 ? splitCashReceived : splitAmount.CASH;
  const splitCashChange = splitOn.CASH
    ? Math.max(cashReceivedEffective - splitAmount.CASH, 0)
    : 0;
  const splitLines: SplitPaymentLine[] = selectedMethods.map((m) => {
    if (m === "CASH") {
      return {
        method: m,
        amount: splitAmount.CASH,
        receivedAmount: cashReceivedEffective,
      };
    }
    if (m === "TEMPO") {
      return { method: m, amount: tempoAmount, dueDate };
    }
    return { method: m, amount: splitAmount[m] };
  });
  const splitError: string | null = !isSplit
    ? null
    : selectedMethods.length < 2
      ? "Pilih minimal 2 metode pembayaran"
      : validateSplitPayments(total, splitLines, customerName);

  const isPayable = isSplit
    ? splitError === null
    : method === "CASH"
      ? paidAmount >= total
      : method === "TEMPO"
        ? customerName.trim().length > 0 && dueDate.length > 0
        : true;

  // ── TAMBAHAN (Midtrans) ── Form terkunci saat proses berjalan ATAU saat
  // pembayaran digital sudah lunas tapi transaksi belum tersimpan (nominal &
  // metode tidak boleh berubah lagi, supaya cocok dengan yang sudah dibayar).
  const lockInputs = isProcessing || paidDigital !== null;

  function toggleSplitMethod(target: PaymentMethod) {
    setLocalError(null);
    setSplitOn((prev) => ({ ...prev, [target]: !prev[target] }));
  }

  function setSplitAmountFor(target: PaymentMethod, value: number) {
    setLocalError(null);
    const clean = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setSplitAmount((prev) => ({ ...prev, [target]: clean }));
  }

  // Isi nominal metode ini dengan sisa yang belum tertutup metode LAIN.
  function fillSplitRemainder(target: PaymentMethod) {
    const others = typedSum - (splitAmount[target] || 0);
    setSplitAmountFor(target, Math.max(total - others, 0));
  }

  // ── TAMBAHAN (Midtrans, langkah 7) ── Popup Snap. Gagal membuka popup TIDAK
  // menggagalkan proses: order sudah ada, kasir bisa menekan "Buka Pembayaran"
  // lagi atau "Batalkan".
  async function openSnapForOrder(order: MidtransOrder) {
    try {
      await openSnapPopup(order, {
        // Pelanggan baru saja menyelesaikan pembayaran di popup: cek status
        // segera (webhook/polling berikutnya bisa terlambat beberapa detik).
        onSuccess: () => {
          void getMidtransStatus(order.orderId).catch(() => undefined);
        },
        onError: () =>
          setDigitalNote(
            "Midtrans melaporkan kendala pada pembayaran ini. Kalau pelanggan sudah membayar, status akan terupdate otomatis.",
          ),
      });
    } catch (err) {
      setDigitalNote(
        err instanceof Error ? err.message : "Popup pembayaran gagal dibuka.",
      );
    }
  }

  // Menjalankan pembayaran digital sampai LUNAS, lalu mengembalikan Order ID.
  // Melempar error kalau gagal/kedaluwarsa/dibatalkan. Transaksi POS BARU
  // disimpan sesudah fungsi ini berhasil (lihat handleProcessPayment).
  async function runDigitalPayment(amount: number): Promise<string> {
    // Sudah lunas di percobaan sebelumnya (penyimpanan transaksi yang gagal):
    // jangan tagih lagi, cukup simpan ulang transaksinya.
    if (paidDigital) {
      if (paidDigital.amount !== amount) {
        throw new Error(
          `Pembayaran digital ${formatRp(paidDigital.amount)} sudah diterima (Order ${paidDigital.orderId}), tetapi nominal digital transaksi sekarang ${formatRp(amount)}. Hubungi supervisor.`,
        );
      }
      return paidDigital.orderId;
    }

    cancelResultRef.current = null;
    setDigitalNote(null);
    setDigitalMidtransStatus(null);
    setDigitalPhase("creating");

    let order: MidtransOrder;
    try {
      order = await createMidtransOrder({
        amount,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        // Kalau percobaan sebelumnya berhenti karena gangguan jaringan, order
        // pending yang sama dipakai lagi (bukan membuat tagihan kedua).
        reuseOrderId: digitalOrderRef.current?.orderId,
      });
    } catch (err) {
      setDigitalPhase("idle");
      throw err;
    }

    digitalOrderRef.current = order;
    setDigitalOrder(order);
    setDigitalPhase("waiting");
    void openSnapForOrder(order);

    const controller = new AbortController();
    pollAbortRef.current = controller;

    let result: MidtransStatusResult | null = null;
    try {
      result = await waitForMidtransResult(order.orderId, {
        signal: controller.signal,
        expiresAt: order.expiresAt,
        onUpdate: (r) => setDigitalMidtransStatus(r.midtransStatus),
      });
    } catch (err) {
      if (!isAbortError(err)) {
        // Gangguan jaringan berkepanjangan: order tetap pending di server,
        // percobaan berikutnya akan memakainya lagi.
        closeSnapPopup();
        setDigitalPhase("idle");
        throw err;
      }
      // Dibatalkan kasir. Kalau ternyata pelanggan SUDAH membayar di detik
      // terakhir (hasil cancel = paid), uangnya sudah masuk — lanjutkan simpan.
      // (cast: TypeScript mengira ref ini masih null karena di atas kita
      // mengisinya null — padahal handleCancelDigital mengisinya saat menunggu.)
      const cancelled = cancelResultRef.current as MidtransStatusResult | null;
      if (cancelled && cancelled.status === "paid") result = cancelled;
    } finally {
      pollAbortRef.current = null;
    }

    closeSnapPopup();
    setDigitalPhase("idle");

    if (!result) {
      digitalOrderRef.current = null;
      setDigitalOrder(null);
      throw new DigitalCancelledError();
    }

    if (result.status === "paid") {
      if (result.used) {
        digitalOrderRef.current = null;
        setDigitalOrder(null);
        throw new Error(
          "Order pembayaran digital ini sudah dipakai untuk transaksi lain. Ulangi pembayaran.",
        );
      }
      digitalOrderRef.current = null;
      setDigitalOrder(null);
      setPaidDigital({ orderId: order.orderId, amount });
      return order.orderId;
    }

    // failed / expired / cancelled: order sudah tidak bisa dibayar.
    digitalOrderRef.current = null;
    setDigitalOrder(null);
    throw new Error(
      result.status === "expired"
        ? "Waktu pembayaran digital habis. Silakan coba lagi."
        : result.status === "failed"
          ? "Pembayaran digital ditolak atau gagal. Silakan coba lagi."
          : "Pembayaran digital dibatalkan.",
    );
  }

  // Kasir menekan "Cek Status": tanya server sekarang juga. Perubahan status
  // akan ditangkap loop polling paling lambat pada tik berikutnya (3 detik).
  async function handleCheckDigitalStatus() {
    const order = digitalOrderRef.current;
    if (!order || checkingDigital) return;
    setCheckingDigital(true);
    try {
      const r = await getMidtransStatus(order.orderId);
      setDigitalMidtransStatus(r.midtransStatus);
      setDigitalNote(
        r.status === "pending" ? "Belum ada pembayaran yang masuk." : null,
      );
    } catch (err) {
      setDigitalNote(
        err instanceof Error ? err.message : "Gagal mengecek status.",
      );
    } finally {
      setCheckingDigital(false);
    }
  }

  async function handleReopenSnap() {
    const order = digitalOrderRef.current;
    if (!order) return;
    setDigitalNote(null);
    await openSnapForOrder(order);
  }

  // Kasir menekan "Batalkan Pembayaran Digital". Order dibatalkan di Midtrans
  // (bukan cuma ditutup di layar) supaya pelanggan tidak bisa membayar
  // belakangan tanpa ada transaksi. Hasilnya diserahkan ke runDigitalPayment
  // lewat cancelResultRef + abort polling.
  async function handleCancelDigital() {
    const order = digitalOrderRef.current;
    if (!order || cancellingDigital) return;
    setCancellingDigital(true);
    try {
      const result = await cancelMidtransOrder(order.orderId);
      cancelResultRef.current = result;
      pollAbortRef.current?.abort();
    } catch (err) {
      setDigitalNote(
        err instanceof Error
          ? `Gagal membatalkan: ${err.message}`
          : "Gagal membatalkan pembayaran.",
      );
    } finally {
      setCancellingDigital(false);
    }
  }

  // Menutup modal lewat tombol X. Kalau pembayaran digital sudah lunas tapi
  // transaksi belum tersimpan, minta konfirmasi dulu.
  function handleRequestClose() {
    if (
      paidDigital &&
      !window.confirm(
        `Pembayaran digital ${formatRp(paidDigital.amount)} sudah diterima tetapi transaksi BELUM tersimpan.\n\nOrder ID: ${paidDigital.orderId}\n\nCatat Order ID ini dan hubungi supervisor. Tetap tutup?`,
      )
    ) {
      return;
    }
    onClose();
  }

  async function handleProcessPayment() {
    if (!isPayable || isProcessing) return;

    setLocalError(null);
    setIsProcessing(true);

    try {
      const finalPaidAmount = method === "CASH" ? paidAmount : total;
      const finalChange = method === "CASH" ? changeAmount : 0;

      // ── TAMBAHAN (013) ── customerPhone dikirim untuk SEMUA metode (opsional,
      // PRD §4.2), bukan hanya TEMPO seperti customerName. trim() -> undefined
      // kalau kosong, konsisten dengan pola customerName di TEMPO.
      const trimmedPhone = customerPhone.trim();

      // ── TAMBAHAN (Midtrans) ── Metode Digital: tagih & tunggu LUNAS dulu,
      // baru transaksi disimpan (stok/kas tidak tersentuh kalau tidak jadi bayar).
      let digitalOrderId: string | undefined;
      if (method === "DIGITAL") {
        digitalOrderId = await runDigitalPayment(total);
      }

      await onConfirmPayment(method, finalPaidAmount, finalChange, {
        // ── KOREKSI (021) ── Sebelumnya nama HANYA dikirim untuk TEMPO, padahal
        // field "Nama Pelanggan (opsional)" tampil untuk semua metode lain —
        // nama yang diketik kasir diam-diam terbuang dan tidak pernah tersimpan.
        customerName: customerName.trim() || undefined,
        customerPhone: trimmedPhone || undefined,
        dueDate: method === "TEMPO" ? dueDate : undefined,
        digitalOrderId,
      });

      setPaidDigital(null);
      setIsProcessing(false);

      // ── KOREKSI (013) ── Layar sukses tetap terbuka sampai kasir menekan
      // salah satu tombolnya (kirim WA / transaksi baru) — tidak ada lagi
      // penutupan otomatis. Struk sudah dicetak/disiapkan parent sebelum
      // Promise ini resolve.
      setIsSuccess(true);
    } catch (err) {
      setIsProcessing(false);
      // Dibatalkan kasir sendiri: kembali ke form tanpa banner error.
      if (err instanceof DigitalCancelledError) {
        setLocalError(null);
        return;
      }
      setLocalError(
        err instanceof Error ? err.message : "Pembayaran gagal diproses.",
      );
    }
  }

  // ── TAMBAHAN (021) ── Proses pembayaran mode split. Transaksi disimpan
  // atomik di RPC; kalau gagal, pesan errornya ditampilkan di modal.
  async function handleProcessSplitPayment() {
    if (!onConfirmSplitPayment || !isPayable || isProcessing) return;

    setLocalError(null);
    setIsProcessing(true);

    try {
      // ── TAMBAHAN (Midtrans) ── Ada baris DIGITAL di split: tagih porsi itu
      // saja dan tunggu lunas sebelum menyimpan transaksi.
      const digitalLine = splitLines.find((line) => line.method === "DIGITAL");
      let digitalOrderId: string | undefined;
      if (digitalLine) {
        digitalOrderId = await runDigitalPayment(digitalLine.amount);
      }

      await onConfirmSplitPayment(splitLines, {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        digitalOrderId,
      });

      setPaidDigital(null);
      setIsProcessing(false);
      setIsSuccess(true);
    } catch (err) {
      setIsProcessing(false);
      if (err instanceof DigitalCancelledError) {
        setLocalError(null);
        return;
      }
      setLocalError(
        err instanceof Error ? err.message : "Pembayaran gagal diproses.",
      );
    }
  }

  // ── TAMBAHAN (013) ── Tombol "Kirim WA" di layar sukses. Status ditangani
  // di sini (bukan langsung di JSX) supaya pesan error dari shareReceiptViaWhatsApp
  // (mis. browser tidak izinkan popup wa.me) bisa ditampilkan tanpa membuat
  // kasir mengira TRANSAKSINYA yang gagal.
  async function handleSendWhatsApp() {
    if (!onSendWhatsApp || waStatus === "sending") return;
    setWaStatus("sending");
    setWaError(null);
    try {
      const result = await onSendWhatsApp();
      setWaMethod(result.method);
      setWaStatus("sent");
    } catch (err) {
      setWaStatus("error");
      setWaError(
        err instanceof Error
          ? err.message
          : "Gagal mengirim struk ke WhatsApp.",
      );
    }
  }

  function handleFinishTransaction() {
    setIsSuccess(false);
    onClose();
  }
  // Ganti mode Satu Metode / Split: bersihkan pesan error lama.
  function handleModeChange(next: "single" | "split") {
    setLocalError(null);
    setMode(next);
  }

  if (isSuccess) {
    return (
      <PaymentSuccessView
        receipt={receipt}
        printToastVisible={printToastVisible}
        printToastDurationMs={PRINT_TOAST_DURATION_MS}
        canSendWhatsApp={Boolean(onSendWhatsApp)}
        waStatus={waStatus}
        waMethod={waMethod}
        waError={waError}
        onSendWhatsApp={handleSendWhatsApp}
        onFinish={handleFinishTransaction}
      />
    );
  }

  return (
    <Modal
      size="lg"
      padding="none"
      layout="flex"
    >
      <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <h2 className="font-semibold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
          Pembayaran
        </h2>
        <IconButton
          onClick={handleRequestClose}
          disabled={isProcessing}
          aria-label="Tutup"
          variant="soft"
        >
          <X className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="p-5 flex-1 overflow-y-auto">
        <PaymentSummaryCard subtotal={subtotal} tax={tax} total={total} />

        {/* ── TAMBAHAN (021) ── Pemilih mode: satu metode / split. Hanya tampil
            kalau parent menyediakan onConfirmSplitPayment. */}
        {splitAvailable && (
          <PaymentModeSwitch
            mode={mode}
            lockInputs={lockInputs}
            onModeChange={handleModeChange}
          />
        )}

        {!isSplit && (
          <SinglePaymentForm
            availableMethods={availableMethods}
            method={method}
            onMethodChange={setMethod}
            lockInputs={lockInputs}
            total={total}
            customerName={customerName}
            onCustomerNameChange={setCustomerName}
            customerPhone={customerPhone}
            onCustomerPhoneChange={setCustomerPhone}
            dueDate={dueDate}
            onDueDateChange={setDueDate}
            paidAmount={paidAmount}
            onPaidAmountChange={setPaidAmount}
            changeAmount={changeAmount}
          />
        )}

        {/* ── TAMBAHAN (021, T-11 bagian 2) ── UI SPLIT PAYMENT.
            Aturan: pilih ≥ 2 metode; tiap metode 1 baris; jumlah nominal harus
            persis = total. TEMPO hanya menampung SISA (nominal otomatis), jadi
            piutang tidak bisa salah ketik. */}
        {isSplit && (
          <SplitPaymentForm
            availableMethods={availableMethods}
            lockInputs={lockInputs}
            total={total}
            splitOn={splitOn}
            selectedMethods={selectedMethods}
            splitAmount={splitAmount}
            splitCashReceived={splitCashReceived}
            splitCashChange={splitCashChange}
            tempoAmount={tempoAmount}
            splitPaidSum={splitPaidSum}
            dueDate={dueDate}
            customerName={customerName}
            customerPhone={customerPhone}
            onToggleMethod={toggleSplitMethod}
            onFillRemainder={fillSplitRemainder}
            onAmountChange={setSplitAmountFor}
            onCashReceivedChange={setSplitCashReceived}
            onDueDateChange={setDueDate}
            onCustomerNameChange={setCustomerName}
            onCustomerPhoneChange={setCustomerPhone}
          />
        )}

        {/* ── TAMBAHAN (Midtrans) ── Panel menunggu pembayaran digital. Tombol
            di dalamnya TIDAK ikut terkunci oleh isProcessing (memang harus
            bisa ditekan selagi menunggu). */}
        {digitalPhase !== "idle" && (
          <DigitalPaymentPanel
            digitalPhase={digitalPhase}
            digitalOrder={digitalOrder}
            digitalMidtransStatus={digitalMidtransStatus}
            digitalNote={digitalNote}
            checkingDigital={checkingDigital}
            cancellingDigital={cancellingDigital}
            onReopenSnap={handleReopenSnap}
            onCheckStatus={handleCheckDigitalStatus}
            onCancel={handleCancelDigital}
          />
        )}

        {/* ── TAMBAHAN (Midtrans) ── Pembayaran digital sudah lunas tetapi
            transaksi belum tersimpan (mis. koneksi ke database putus). */}
        {paidDigital && digitalPhase === "idle" && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-lco-green/30 bg-lco-green/10 p-3 text-xs text-lco-green">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">
                Pembayaran digital diterima
              </p>
              <p>
                {formatRp(paidDigital.amount)} sudah lunas (Order{" "}
                <span className="font-mono">{paidDigital.orderId}</span>).{" "}
                {isProcessing
                  ? "Menyimpan transaksi..."
                  : "Transaksi belum tersimpan — tekan tombol di bawah untuk menyimpan ulang. Jangan menagih pelanggan lagi."}
              </p>
            </div>
          </div>
        )}

        {localError && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-lco-coral/30 bg-lco-coral/10 p-3 text-xs text-lco-coral">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Pembayaran gagal</p>
              <p>{localError}</p>
            </div>
          </div>
        )}
      </div>

      <PaymentFooter
        onSubmit={isSplit ? handleProcessSplitPayment : handleProcessPayment}
        isPayable={isPayable}
        isProcessing={isProcessing}
        isSplit={isSplit}
        splitError={splitError}
        method={method}
        changeAmount={changeAmount}
        hasPaidDigital={paidDigital !== null}
        splitDigitalOn={splitOn.DIGITAL}
        digitalPhase={digitalPhase}
      />
    </Modal>
  );
}
