"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal, { ModalHeader } from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";

interface ConfirmDeleteModalProps {
  title: string;
  /** Penjelasan akibat penghapusan, ditulis spesifik untuk data yang dihapus. */
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function ConfirmDeleteModal({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setIsDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus data.");
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      size="sm"
      aria-label={title}
      onEscape={isDeleting ? undefined : onClose}
    >
      <ModalHeader
        title={title}
        icon={<AlertTriangle className="h-4 w-4 text-red-700 dark:text-lco-coral" />}
        onClose={onClose}
        closeDisabled={isDeleting}
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{description}</p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={isDeleting}
        >
          Batal
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={handleConfirm}
          disabled={isDeleting}
          autoFocus
        >
          {isDeleting ? "Menghapus..." : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
