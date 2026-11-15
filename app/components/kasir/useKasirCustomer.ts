"use client";

// app/components/kasir/useKasirCustomer.ts
// ── Dipecah dari KasirModule.tsx. Memegang pelanggan yang dipilih di layar
// Kasir (opsional), pencarian pelanggan, status pemakaian poin loyalitas, dan
// penautan pelanggan saat transaksi (resolveCustomerId). Isi dipindah apa
// adanya; pencarian per-kata ada di filterCustomers (lib/pos/kasirLogic.ts).

import { useMemo, useState } from "react";
import { useCustomers, type Customer } from "@/hooks/useCustomers";
import { normalizePhone } from "@/hooks/useCustomerAdmin";
import { filterCustomers } from "@/lib/pos/kasirLogic";

export function useKasirCustomer() {
  const { customers, refetch: refetchCustomers, addCustomer } = useCustomers();

  const [customerQuery, setCustomerQuery] = useState("");
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [usePoints, setUsePoints] = useState(false);
  const [isLoyaltyNoticeDismissed, setIsLoyaltyNoticeDismissed] =
    useState(false);

  const matchingCustomers = useMemo(
    () => filterCustomers(customers, customerQuery),
    [customers, customerQuery],
  );

  const handleSelectCustomer = (c: Customer) => {
    setSelectedCustomer(c);
    setUsePoints(false);
    setIsLoyaltyNoticeDismissed(false);
    setCustomerQuery("");
    setIsCustomerDropdownOpen(false);
  };

  /** Ketik di kolom pencarian pelanggan (sekaligus membuka dropdown). */
  const handleCustomerQueryChange = (value: string) => {
    setCustomerQuery(value);
    setIsCustomerDropdownOpen(true);
  };

  /** Lepas pelanggan terpilih (tombol X). */
  const handleClearCustomer = () => {
    setSelectedCustomer(null);
    setUsePoints(false);
  };

  /** Dipanggil setelah transaksi sukses supaya transaksi berikutnya mulai bersih. */
  const resetAfterSale = () => {
    setSelectedCustomer(null);
    setUsePoints(false);
  };

  // Menentukan ID pelanggan yang ditautkan ke transaksi (dipanggil SEBELUM
  // transaksi dibuat, supaya poin belanja otomatis masuk — migration 036):
  //   1. pelanggan yang dipilih kasir di panel Pelanggan -> pakai itu;
  //   2. tidak dipilih, tapi no. HP yang diketik cocok dengan pelanggan aktif
  //      -> tautkan ke pelanggan itu;
  //   3. no. HP baru -> daftarkan (nama kosong -> no. HP dipakai sebagai nama).
  // Sengaja tidak melempar error: gagal mendaftar (mis. nomor milik pelanggan
  // yang diarsipkan) hanya berarti transaksi berjalan tanpa pelanggan.
  const resolveCustomerId = async (
    name?: string,
    phone?: string,
  ): Promise<string | undefined> => {
    if (selectedCustomer) return selectedCustomer.id;
    if (!phone) return undefined;
    const key = normalizePhone(phone);
    if (key.length < 9) return undefined;
    const existing = customers.find((c) => normalizePhone(c.phone) === key);
    if (existing) return existing.id;
    try {
      const created = await addCustomer(
        name?.trim() || phone.trim(),
        phone.trim(),
      );
      return created.id;
    } catch (registerErr) {
      console.error("Gagal mendaftarkan pelanggan baru:", registerErr);
      return undefined;
    }
  };

  return {
    selectedCustomer,
    customerQuery,
    isCustomerDropdownOpen,
    setIsCustomerDropdownOpen,
    matchingCustomers,
    usePoints,
    setUsePoints,
    isLoyaltyNoticeDismissed,
    setIsLoyaltyNoticeDismissed,
    handleSelectCustomer,
    handleCustomerQueryChange,
    handleClearCustomer,
    resetAfterSale,
    resolveCustomerId,
    refetchCustomers,
  };
}
