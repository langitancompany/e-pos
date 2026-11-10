"use client";

// app/components/kasir/KasirModule.tsx
// ── DIPECAH (sebelumnya 2.117 baris, 41 useState). File ini sekarang hanya
// orkestrator: memanggil hook, menghitung total, lalu menyusun panel. Semua
// isi lama dipindah APA ADANYA (tanpa perubahan alur bisnis) ke:
//
//   Logika murni (dites)   lib/pos/kasirLogic.ts
//                          pajak, diskon poin, kode PC "qty*kode", scan barcode,
//                          filter produk/pelanggan, penyusunan struk
//   Hook                   useKasirLayoutMode   pilihan layout tablet/PC per-device
//                          useKasirCart         keranjang + kode PC + scan kamera
//                          useKasirCustomer     pelanggan, poin, resolveCustomerId
//                          useKasirHold         Tunda + daftar pesanan tertunda
//                          useKasirShiftSession buka/tutup sesi, kas masuk/keluar, cabang
//                          useKasirCheckout     bayar tunggal/split, struk, WA, cetak
//                          useKasirShortcuts    F1-F8 mode PC
//   Tampilan               KasirOpenSessionScreen, KasirProductPanel (+ Grid,
//                          CustomerPicker), KasirCartPanel, KasirHoldModal,
//                          KasirHeldOrdersModal, KasirBiayaTambahanModal
//
// Kontrak ke luar TIDAK berubah: props KasirModule, props yang dikirim ke
// PaymentModal / KasirModulePC / KasirTopBar, dan import dinamis di page.tsx.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import BarcodeScanModal from "./BarcodeScanModal";
import PaymentModal from "./PaymentModal";
import KasirTopBar from "./KasirTopBar";
import KasirModulePC from "./KasirModulePC";
import KasirOpenSessionScreen from "./KasirOpenSessionScreen";
import KasirProductPanel from "./KasirProductPanel";
import KasirCustomerPicker from "./KasirCustomerPicker";
import KasirCartPanel from "./KasirCartPanel";
import KasirHoldModal from "./KasirHoldModal";
import KasirHeldOrdersModal from "./KasirHeldOrdersModal";
import KasirBiayaTambahanModal from "./KasirBiayaTambahanModal";
import KasirCustomPriceModal from "./KasirCustomPriceModal";
import { CashMovementModal } from "./CashMovementModal";
import { CloseShiftModal, CloseShiftSummaryModal } from "./CloseShiftModal";
import { useKasirLayoutMode } from "./useKasirLayoutMode";
import { useKasirCart } from "./useKasirCart";
import { useKasirCustomer } from "./useKasirCustomer";
import { useKasirHold } from "./useKasirHold";
import { useKasirShiftSession } from "./useKasirShiftSession";
import { useKasirCheckout } from "./useKasirCheckout";
import { useKasirShortcuts } from "./useKasirShortcuts";
import { useProducts } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import { usePrinterProfiles } from "@/hooks/usePrinterProfiles";
import { normalizePhone } from "@/hooks/useCustomerAdmin";
import {
  clearCart,
  getCartItemCount,
  getCartSubtotal,
} from "@/lib/pos/cartLogic";
import {
  calcDiscount,
  calcGrandTotal,
  calcPointsBeingUsed,
  calcTax,
  filterProducts,
  filterServiceProducts,
  parseDigits,
} from "@/lib/pos/kasirLogic";
import Button from "@/app/components/ui/Button";

interface KasirModuleProps {
  // Keluar dari layar Kasir balik ke Dashboard — dipakai saat kasir
  // membatalkan modal Buka Kasir, dan setelah ringkasan Tutup Sesi Kas.
  onExitKasir?: () => void;
  // Tombol "Menu" di KasirTopBar (mode PC & tablet) cuma MEMBUKA Sidebar sebagai
  // drawer DI ATAS layar Kasir (callback dari page.tsx). Kasir baru benar-benar
  // ditinggalkan kalau kasir memilih menu lain di drawer itu.
  onOpenMenu?: () => void;
}

export default function KasirModule({
  onExitKasir,
  onOpenMenu,
}: KasirModuleProps) {
  const { products, isLoading, error, refetch } = useProducts();
  const { categories } = useCategories();
  const { user } = useAuth();
  const { settings: posSettings, outlet } = useSettings();
  const loyaltyPointValue = outlet.loyaltyPointValue;
  const { printReceipt } = usePrinterProfiles();

  const { layoutMode, toggleLayoutMode } = useKasirLayoutMode();

  // ── Diskon Faktur (mode PC) ── Diskon manual yang diketik langsung kasir
  // (beda dari potongan poin loyalitas — dua-duanya ADDITIF, lihat calcDiscount).
  const [manualDiscountInput, setManualDiscountInput] = useState("");
  const manualDiscount = parseDigits(manualDiscountInput);

  // ── Sesi kas / shift / cabang ──
  const session = useKasirShiftSession({
    posSettings,
    outlet,
    user,
    printReceipt,
    onExitKasir,
  });
  const { activeShift, isShiftLoading } = session;

  // ── Pelanggan & poin ──
  const customer = useKasirCustomer();

  // ── State layar ──
  // Di layar sempit (di bawah `md`) panel Produk & Keranjang jadi 2 "layar"
  // yang di-toggle lewat `mobileView`; dari `md` ke atas keduanya berdampingan.
  const [mobileView, setMobileView] = useState<"products" | "cart">("products");
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [isBiayaTambahanModalOpen, setIsBiayaTambahanModalOpen] =
    useState(false);

  // Token yang di-increment tiap shortcut F1/F2/F6 ditekan — KasirModulePC punya
  // useEffect yang me-fokus input terkait tiap token berubah (pola token dipakai
  // supaya file ini tidak perlu tahu detail DOM input di KasirModulePC).
  const [pcFocusCodeToken, setPcFocusCodeToken] = useState(0);
  const [pcFocusCustomerToken, setPcFocusCustomerToken] = useState(0);
  const [pcFocusDiscountToken, setPcFocusDiscountToken] = useState(0);

  // ── Keranjang & Tunda ──
  const cartState = useKasirCart({ products, setTransactionError });
  const { cart, setCart } = cartState;
  const hold = useKasirHold({
    cart,
    products,
    setCart,
    setMobileView,
    setTransactionError,
  });

  // ── PERBAIKAN (BUG: "layar kedip/refresh setelah bayar, sukses tidak pernah
  // tampil") ── `isLoading` dari useProducts() juga menyala true saat refetch()
  // manual (setelah transaksi sukses, untuk update stok), bukan cuma load
  // pertama. Dulu guard spinner full-screen memakai isLoading apa adanya, jadi
  // tiap refetch SELURUH layar (termasuk PaymentModal di layar sukses) dibuang
  // lalu di-mount ULANG dan PaymentModal otomatis reset ke form. Sekarang
  // `hasLoadedInitial` hanya menahan spinner SEBELUM data pertama selesai
  // dimuat; setelah itu data lama tetap tampil sampai data baru datang.
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  useEffect(() => {
    if (!isLoading && !isShiftLoading && !hasLoadedInitial) {
      setHasLoadedInitial(true);
    }
  }, [isLoading, isShiftLoading, hasLoadedInitial]);

  // ── Turunan katalog ──
  const filteredProducts = useMemo(
    () => filterProducts(products, searchQuery, selectedCategoryId),
    [products, searchQuery, selectedCategoryId],
  );
  const serviceProducts = useMemo(
    () => filterServiceProducts(products),
    [products],
  );

  // ── Total (aturan hitung ada di lib/pos/kasirLogic.ts) ──
  const subtotal = useMemo(() => getCartSubtotal(cart), [cart]);
  const tax = useMemo(
    () => calcTax(subtotal, posSettings.ppnEnabled, posSettings.ppnRate),
    [posSettings.ppnEnabled, posSettings.ppnRate, subtotal],
  );
  // Poin yang benar-benar dipakai dibatasi supaya potongan tidak melebihi
  // subtotal+pajak; angka INI juga yang dikirim ke createTransaction() sebagai
  // `pointsRedeemed` (server yang memotong saldo — migration 036).
  const selectedCustomerPoints =
    customer.selectedCustomer?.loyalty_points ?? null;
  const pointsBeingUsed = useMemo(
    () =>
      calcPointsBeingUsed({
        loyaltyEnabled: outlet.loyaltyEnabled,
        usePoints: customer.usePoints,
        customerPoints: selectedCustomerPoints,
        subtotal,
        tax,
        pointValue: loyaltyPointValue,
      }),
    [
      outlet.loyaltyEnabled,
      customer.usePoints,
      selectedCustomerPoints,
      subtotal,
      tax,
      loyaltyPointValue,
    ],
  );
  const discount = useMemo(
    () =>
      calcDiscount({
        pointsBeingUsed,
        pointValue: loyaltyPointValue,
        manualDiscount,
        subtotal,
        tax,
      }),
    [pointsBeingUsed, manualDiscount, subtotal, tax, loyaltyPointValue],
  );
  const grandTotal = calcGrandTotal(subtotal, discount, tax);

  // ── Pembayaran ──
  const checkout = useKasirCheckout({
    cart,
    subtotal,
    discount,
    tax,
    grandTotal,
    pointsBeingUsed,
    posSettings,
    outlet,
    user,
    printReceipt,
    selectedCustomer: customer.selectedCustomer,
    resolveCustomerId: customer.resolveCustomerId,
    refetchCustomers: customer.refetchCustomers,
    refetchProducts: refetch,
    // Transaksi berikutnya mulai bersih (tidak ikut ke pelanggan sebelumnya).
    resetAfterSale: () => {
      setCart(clearCart());
      setMobileView("products");
      customer.resetAfterSale();
      setManualDiscountInput("");
    },
    setTransactionError,
  });

  // ── Shortcut keyboard (hanya mode PC & shift terbuka) ──
  useKasirShortcuts(layoutMode === "pc" && !!activeShift, {
    onFocusCode: () => setPcFocusCodeToken((t) => t + 1),
    onFocusCustomer: () => setPcFocusCustomerToken((t) => t + 1),
    onHold: hold.openHoldModal,
    onClearCart: () => {
      if (cart.length > 0 && window.confirm("Bersihkan keranjang?")) {
        cartState.clearCartAndSelection();
      }
    },
    onFocusDiscount: () => setPcFocusDiscountToken((t) => t + 1),
    onOpenBiayaTambahan: () => setIsBiayaTambahanModalOpen(true),
    onPay: checkout.handleOpenPayment,
  });

  // ── KOREKSI ── KEDUA sumber loading (produk & status shift) digabung jadi satu
  // kondisi, supaya layar utama Kasir tidak pernah dirender sebelum status shift
  // benar-benar diketahui (dulu sempat "kedip" ke layar terkunci).
  if (!hasLoadedInitial && (isLoading || isShiftLoading)) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-xs">Memuat layar Kasir...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AlertTriangle className="w-6 h-6 text-lco-coral" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Gagal memuat produk: {error}
          </p>
          <Button onClick={refetch} size="sm">
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  // Tanpa shift aktif: modal "Mulai Sesi Kasir" langsung terbuka (atau ringkasan
  // selisih setelah Tutup Sesi Kas). Detail di KasirOpenSessionScreen.
  if (!activeShift) {
    return (
      <KasirOpenSessionScreen
        closeResult={session.closeResult}
        onFinishClose={session.handleFinishCloseSession}
        onExitKasir={onExitKasir}
        branchChoices={session.branchChoices}
        activeBranch={session.activeBranch}
        activeBranchId={session.activeBranchId}
        setActiveBranch={session.setActiveBranch}
        openingCashValue={session.openingCashValue}
        setOpeningCashInput={session.setOpeningCashInput}
        isStartingSession={session.isStartingSession}
        openSessionError={session.openSessionError}
        onStartSession={session.handleStartSession}
      />
    );
  }

  return (
    <div
      className={`h-full flex flex-col bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden ${
        // Mode PC: tiap bagian berupa KARTU sendiri dengan jarak antar kartu
        // (lihat KasirModulePC.tsx) — jadi container luar perlu padding+gap.
        layoutMode === "pc" ? "gap-2 p-2" : ""
      }`}
    >
      {/* Kasir full-screen: bar ini SATU-SATUNYA cara kasir balik ke Dashboard /
          lihat Pending / ganti ke mode PC / tutup sesi / buka layar Display. */}
      <KasirTopBar
        storeName={posSettings.namaToko}
        onOpenMenu={onOpenMenu}
        heldOrdersCount={hold.heldOrders.length}
        onOpenHeldList={hold.openHeldList}
        onCloseShift={() => session.setIsCloseModalOpen(true)}
        onOpenCashMovement={() => session.setIsCashModalOpen(true)}
        layoutMode={layoutMode}
        onToggleLayout={toggleLayoutMode}
        variant={layoutMode === "pc" ? "card" : "strip"}
        onOpenDisplay={() =>
          window.open(
            `/kasir-display?shift=${activeShift.id}`,
            "kasir-display",
            "width=1024,height=768",
          )
        }
      />

      {session.isCashModalOpen && (
        <CashMovementModal
          onClose={() => session.setIsCashModalOpen(false)}
          onSubmit={session.handleAddCashMovement}
        />
      )}
      {session.isCloseModalOpen && (
        <CloseShiftModal
          onClose={() => session.setIsCloseModalOpen(false)}
          onSubmit={session.handleCloseSession}
          cashMovementSummary={session.cashSummary}
        />
      )}
      {session.closeResult && (
        <CloseShiftSummaryModal
          result={session.closeResult}
          onDone={session.handleFinishCloseSession}
        />
      )}

      {layoutMode === "pc" ? (
        <KasirModulePC
          cashierName={user?.full_name ?? user?.email ?? "-"}
          cart={cart}
          products={products}
          onAddProduct={cartState.handlePcAddProduct}
          subtotal={subtotal}
          tax={tax}
          discount={discount}
          grandTotal={grandTotal}
          onUpdateQty={cartState.handleUpdateQty}
          onRemoveFromCart={cartState.handleRemoveFromCart}
          onClearCart={cartState.clearCartAndSelection}
          selectedProductId={cartState.pcSelectedProductId}
          onSelectProductId={cartState.setPcSelectedProductId}
          onSubmitCode={cartState.handlePcCodeSubmit}
          codeError={cartState.pcCodeError}
          onClearCodeError={() => cartState.setPcCodeError(null)}
          focusCodeToken={pcFocusCodeToken}
          focusCustomerToken={pcFocusCustomerToken}
          focusDiscountToken={pcFocusDiscountToken}
          customerQuery={customer.customerQuery}
          onCustomerQueryChange={customer.handleCustomerQueryChange}
          isCustomerDropdownOpen={customer.isCustomerDropdownOpen}
          onCustomerDropdownOpenChange={customer.setIsCustomerDropdownOpen}
          matchingCustomers={customer.matchingCustomers}
          onSelectCustomer={customer.handleSelectCustomer}
          selectedCustomer={customer.selectedCustomer}
          onClearCustomer={customer.handleClearCustomer}
          usePoints={customer.usePoints}
          onToggleUsePoints={customer.setUsePoints}
          pointsBeingUsed={pointsBeingUsed}
          loyaltyPointValue={loyaltyPointValue}
          loyaltyEnabled={outlet.loyaltyEnabled}
          manualDiscountInput={manualDiscountInput}
          onManualDiscountInputChange={setManualDiscountInput}
          onOpenBiayaTambahan={() => setIsBiayaTambahanModalOpen(true)}
          onHold={hold.openHoldModal}
          onPay={checkout.handleOpenPayment}
          isSavingTransaction={checkout.isSavingTransaction}
        />
      ) : (
        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
          <KasirProductPanel
            mobileView={mobileView}
            customerPicker={
              <KasirCustomerPicker
                selectedCustomer={customer.selectedCustomer}
                customerQuery={customer.customerQuery}
                onQueryChange={customer.handleCustomerQueryChange}
                isCustomerDropdownOpen={customer.isCustomerDropdownOpen}
                onDropdownOpenChange={customer.setIsCustomerDropdownOpen}
                matchingCustomers={customer.matchingCustomers}
                onSelectCustomer={customer.handleSelectCustomer}
                onClearCustomer={customer.handleClearCustomer}
                loyaltyEnabled={outlet.loyaltyEnabled}
                usePoints={customer.usePoints}
                onUsePointsChange={customer.setUsePoints}
                isLoyaltyNoticeDismissed={customer.isLoyaltyNoticeDismissed}
                onDismissLoyaltyNotice={() =>
                  customer.setIsLoyaltyNoticeDismissed(true)
                }
                pointsBeingUsed={pointsBeingUsed}
                discount={discount}
              />
            }
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onOpenScan={cartState.openScanModal}
            onOpenBiayaTambahan={() => setIsBiayaTambahanModalOpen(true)}
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
            products={filteredProducts}
            cart={cart}
            onAddToCart={cartState.handleAddToCart}
            onShowCart={() => setMobileView("cart")}
            grandTotal={grandTotal}
          />

          <KasirCartPanel
            mobileView={mobileView}
            onBackToProducts={() => setMobileView("products")}
            heldCount={hold.heldOrders.length}
            onOpenHeldList={hold.openHeldList}
            cart={cart}
            onUpdateQty={cartState.handleUpdateQty}
            onRemoveFromCart={cartState.handleRemoveFromCart}
            transactionError={transactionError}
            resumeNotice={hold.resumeNotice}
            onDismissResumeNotice={hold.dismissResumeNotice}
            subtotal={subtotal}
            tax={tax}
            ppnRate={posSettings.ppnRate}
            grandTotal={grandTotal}
            isSavingTransaction={checkout.isSavingTransaction}
            onHold={hold.openHoldModal}
            onPay={checkout.handleOpenPayment}
          />
        </div>
      )}

      <PaymentModal
        isOpen={checkout.isPaymentModalOpen}
        // Pelanggan yang dipilih di kolom "Pelanggan [F2]" otomatis terisi di
        // form nama/no. HP pembayaran. Pelanggan "tanpa nama" (nama = no. HP)
        // → nama dikosongkan.
        initialCustomerName={
          customer.selectedCustomer &&
          normalizePhone(customer.selectedCustomer.name) !==
            normalizePhone(customer.selectedCustomer.phone)
            ? customer.selectedCustomer.name
            : ""
        }
        initialCustomerPhone={customer.selectedCustomer?.phone ?? ""}
        onClose={checkout.closePaymentModal}
        subtotal={subtotal}
        tax={tax}
        total={grandTotal}
        onConfirmPayment={checkout.handleConfirmPayment}
        // "Split Bayar" di PaymentModal hanya muncul kalau prop ini ADA
        // (`splitAvailable = !!onConfirmSplitPayment`).
        onConfirmSplitPayment={checkout.handleConfirmSplitPayment}
        onSendWhatsApp={checkout.handleSendWhatsApp}
        // onPrint dipanggil OTOMATIS oleh PaymentModal begitu layar sukses muncul.
        receipt={checkout.lastReceipt}
        onPrint={outlet.autoPrint ? checkout.handlePrintReceipt : undefined}
        digitalEnabled={posSettings.digitalPaymentEnabled}
      />

      {hold.isHoldModalOpen && (
        <KasirHoldModal
          itemCount={getCartItemCount(cart)}
          subtotal={subtotal}
          label={hold.holdLabel}
          onLabelChange={hold.setHoldLabel}
          isHolding={hold.isHolding}
          error={hold.holdModalError}
          onCancel={hold.closeHoldModal}
          onConfirm={hold.handleConfirmHold}
        />
      )}

      {hold.isHeldListOpen && (
        <KasirHeldOrdersModal
          heldOrders={hold.heldOrders}
          isLoading={hold.isHeldOrdersLoading}
          heldListError={hold.heldListError}
          resumingId={hold.resumingId}
          onClose={hold.closeHeldList}
          onResume={hold.handleResumeHeldOrder}
          onDelete={hold.handleDeleteHeldOrder}
        />
      )}

      <BarcodeScanModal
        isOpen={cartState.isScanModalOpen}
        onClose={cartState.closeScanModal}
        onScan={cartState.handleBarcodeScanned}
        feedback={cartState.scanFeedback}
      />

      {isBiayaTambahanModalOpen && (
        <KasirBiayaTambahanModal
          products={serviceProducts}
          cart={cart}
          onAddProduct={cartState.handleAddExtraCharge}
          onClose={() => setIsBiayaTambahanModalOpen(false)}
        />
      )}

      {cartState.customPriceTarget && (
        <KasirCustomPriceModal
          product={cartState.customPriceTarget.product}
          initialQty={cartState.customPriceTarget.qty}
          onConfirm={cartState.confirmCustomPrice}
          onClose={cartState.closeCustomPrice}
        />
      )}
    </div>
  );
}
