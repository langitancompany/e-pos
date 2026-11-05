"use client";

// app/components/kasir/PaymentModeSwitch.tsx
// ── Dipecah dari PaymentModal.tsx — pemilih mode: satu metode / split bayar.
// JSX dipindah apa adanya; state & handler tetap di PaymentModal.tsx dan
// dikirim lewat props.

export default function PaymentModeSwitch({
  mode,
  lockInputs,
  onModeChange,
}: {
  mode: "single" | "split";
  lockInputs: boolean;
  onModeChange: (mode: "single" | "split") => void;
}) {
  return (
    <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-md p-0.5 border border-zinc-200 dark:border-zinc-800 mb-5">
      {(
        [
          { value: "single", label: "Satu Metode" },
          { value: "split", label: "Split Bayar" },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onModeChange(opt.value)}
          disabled={lockInputs}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-sm transition-colors duration-150 disabled:cursor-not-allowed ${
            mode === opt.value
              ? "bg-white dark:bg-zinc-950 text-lco-teal border border-zinc-200 dark:border-zinc-800"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-transparent"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
