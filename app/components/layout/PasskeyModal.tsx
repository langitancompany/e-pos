"use client";

// app/components/layout/PasskeyModal.tsx
// ── BARU (login passkey) ── Dialog kelola passkey milik user yang sedang login:
// daftarkan perangkat ini, lihat daftar, hapus. Dibuka dari UserMenu (header),
// bukan dari menu Pengaturan, karena Pengaturan dibatasi izin sedangkan setiap
// user — termasuk kasir — perlu bisa mendaftarkan sidik jarinya sendiri.
//
// Satu passkey = satu perangkat/penyimpanan (mis. HP kasir, laptop kantor).
// Pendaftarannya memakai verifikasi yang dimiliki perangkat saat itu: sidik
// jari, Face ID, atau kunci layar.

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
import Button from "@/app/components/ui/Button";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import { describePasskeyError, guessDeviceName } from "@/lib/pos/passkeyErrors";
import {
  deletePasskey,
  isPasskeySupported,
  listPasskeys,
  registerPasskey,
  type PasskeyRow,
} from "@/lib/supabase/passkey";

interface PasskeyModalProps {
  onClose: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function PasskeyModal({ onClose }: PasskeyModalProps) {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supported = isPasskeySupported();

  const reload = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
      setLoadError(null);
    } catch (err) {
      setLoadError(describePasskeyError(err, "register"));
      setPasskeys([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Escape menutup dialog, kecuali saat prompt sidik jari sedang berjalan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRegistering) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isRegistering, onClose]);

  async function handleRegister() {
    setIsRegistering(true);
    setActionError(null);
    try {
      await registerPasskey(guessDeviceName(navigator.userAgent));
      await reload();
    } catch (err) {
      // Pesan untuk kasir sengaja ringkas; detail aslinya dicatat di konsol
      // browser supaya penyebab sebenarnya bisa dilacak admin.
      console.error("[passkey] pendaftaran gagal:", err);
      setActionError(describePasskeyError(err, "register"));
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setActionError(null);
    try {
      await deletePasskey(id);
      setConfirmDeleteId(null);
      await reload();
    } catch {
      setActionError("Gagal menghapus passkey. Coba lagi.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal
      size="md"
      aria-label="Sidik jari dan passkey"
      onBackdropClick={isRegistering ? undefined : onClose}
    >
      <ModalHeader
        title="Sidik jari & passkey"
        icon={<Fingerprint className="h-4 w-4 text-lco-teal" />}
        onClose={onClose}
        closeDisabled={isRegistering}
        className="mb-2"
      />
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Daftarkan perangkat ini supaya bisa masuk tanpa mengetik password. Yang
        dipakai menyesuaikan perangkat: sidik jari, Face ID, atau kunci layar.
      </p>

      {!supported ? (
        <p className="rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
          Browser ini belum mendukung passkey. Coba Chrome, Edge, Safari, atau
          Firefox versi terbaru.
        </p>
      ) : (
        <Button
          type="button"
          fullWidth
          onClick={() => void handleRegister()}
          disabled={isRegistering}
        >
          {isRegistering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Fingerprint className="h-4 w-4" />
          )}
          {isRegistering ? "Menunggu verifikasi..." : "Daftarkan perangkat ini"}
        </Button>
      )}

      {actionError && (
        <p className="mt-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-3 py-2 text-xs text-lco-coral">
          {actionError}
        </p>
      )}

      <div className="mt-5">
        <h4 className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Perangkat terdaftar
        </h4>

        {passkeys === null ? (
          <div className="flex items-center gap-2 py-3 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat...
          </div>
        ) : loadError ? (
          <p className="text-xs text-lco-coral">{loadError}</p>
        ) : passkeys.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">
            Belum ada perangkat terdaftar.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {passkeys.map((p) => {
              const used = formatDate(p.last_used_at);
              const isConfirming = confirmDeleteId === p.id;
              const isDeleting = deletingId === p.id;
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {p.friendly_name || "Passkey tanpa nama"}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Didaftarkan {formatDate(p.created_at)}
                      {used ? `, terakhir dipakai ${used}` : ""}
                    </p>
                  </div>
                  {isConfirming ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDelete(p.id)}
                        disabled={isDeleting}
                      >
                        {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Hapus
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={isDeleting}
                      >
                        Batal
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(p.id)}
                      aria-label={`Hapus ${p.friendly_name || "passkey"}`}
                      className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors duration-150 hover:bg-lco-coral/10 hover:text-lco-coral"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
