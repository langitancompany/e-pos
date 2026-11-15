// app/components/transaksi/transactionDetailUtils.ts
// ── Dipecah dari TransactionDetailModal.tsx — helper murni (tanpa React)
// yang dipakai beberapa komponen detail transaksi.

export type PanelMode = "detail" | "retur" | "void";

export function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

export function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    CASH: "Tunai",
    DIGITAL: "Digital",
    TEMPO: "Piutang",
    // Fallback untuk baris lama yang belum termigrasi (migration 034).
    BANK_TRANSFER: "Digital",
    QRIS: "Digital",
  };
  return labels[method] ?? method;
}
