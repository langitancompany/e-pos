"use client";

// Alur: pilih file, baca dan validasi (tanpa menyimpan apa pun), pratinjau,
// lalu impor baris yang valid. Baris bermasalah dilewati dan ditampilkan
// beserta alasannya supaya bisa diperbaiki di Excel dan diunggah ulang.

import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertCircle, Download, Loader2, Upload, X } from "lucide-react";
import Modal from "@/app/components/ui/Modal";
import Button from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import type { Category } from "@/lib/pos/types";
import { readXlsxSheet } from "@/lib/pos/xlsxReader";
import { fetchProductCodes } from "@/lib/pos/productCodesApi";
import {
  MAX_IMPORT_ROWS,
  PRODUCT_SHEET_NAME,
  parseProductSheet,
  summarizeImport,
  type ImportRow,
  type ParsedProduct,
} from "@/lib/pos/productImport";
import { importProducts, type ImportOutcome } from "@/lib/pos/productImportApi";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Stage =
  | { kind: "pick"; error: string | null }
  | { kind: "reading"; fileName: string }
  | { kind: "preview"; fileName: string; rows: ImportRow[] }
  | { kind: "importing"; done: number; total: number }
  | { kind: "done"; outcomes: ImportOutcome[]; skipped: number };

interface ProdukImportModalProps {
  categories: Category[];
  branchId: string | null;
  branchName: string | null;
  onClose: () => void;
  /** Dipanggil begitu impor selesai, supaya daftar produk dimuat ulang. */
  onImported: () => void;
  onDownloadTemplate: () => void;
  templateBusy: boolean;
}

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

const headCellClass =
  "px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";

export default function ProdukImportModal({
  categories,
  branchId,
  branchName,
  onClose,
  onImported,
  onDownloadTemplate,
  templateBusy,
}: ProdukImportModalProps) {
  const [stage, setStage] = useState<Stage>({ kind: "pick", error: null });
  const titleId = useId();

  const canClose = stage.kind !== "reading" && stage.kind !== "importing";

  function handleClose() {
    if (canClose) onClose();
  }

  async function loadFile(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      setStage({
        kind: "pick",
        error: "File harus berformat .xlsx. Simpan file Excel sebagai .xlsx lalu pilih lagi.",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStage({ kind: "pick", error: "Ukuran file melebihi 5 MB." });
      return;
    }

    setStage({ kind: "reading", fileName: file.name });

    try {
      const [sheetRows, codes] = await Promise.all([
        file.arrayBuffer().then((buffer) => readXlsxSheet(buffer, PRODUCT_SHEET_NAME)),
        fetchProductCodes(),
      ]);

      if (!codes.success) {
        setStage({
          kind: "pick",
          error: `Gagal memeriksa SKU dan barcode yang sudah ada: ${codes.error}`,
        });
        return;
      }

      const result = parseProductSheet(sheetRows, {
        categories,
        existingSkus: codes.skus,
        existingBarcodes: codes.barcodes,
      });

      if (!result.ok) {
        setStage({ kind: "pick", error: result.error });
        return;
      }

      setStage({ kind: "preview", fileName: file.name, rows: result.rows });
    } catch {
      setStage({
        kind: "pick",
        error:
          "File tidak bisa dibaca. Pastikan file Excel .xlsx tidak rusak dan tidak diberi password.",
      });
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadFile(file);
  }

  async function startImport(rows: ImportRow[]) {
    const total = rows.filter((row) => row.product).length;
    setStage({ kind: "importing", done: 0, total });

    try {
      const outcomes = await importProducts(rows, {
        branchId,
        onProgress: (done, count) => setStage({ kind: "importing", done, total: count }),
      });
      setStage({ kind: "done", outcomes, skipped: rows.length - total });
    } catch (err) {
      setStage({
        kind: "pick",
        error: `Impor terhenti: ${err instanceof Error ? err.message : "kesalahan tak dikenal"}. Sebagian produk mungkin sudah tersimpan, cek daftar produk.`,
      });
    }
    onImported();
  }

  return (
    <Modal
      size="2xl"
      padding="none"
      layout="flex"
      aria-labelledby={titleId}
      onEscape={canClose ? handleClose : undefined}
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Upload Excel Produk
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Tambah banyak produk sekaligus dari file template.
          </p>
        </div>

        <IconButton
          type="button"
          onClick={handleClose}
          disabled={!canClose}
          aria-label="Tutup"
          variant="soft"
          size="lg"
        >
          <X size={20} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {stage.kind === "pick" && (
          <PickStep
            error={stage.error}
            branchName={branchName}
            categoryCount={categories.length}
            onFileChange={handleFileChange}
            onDownloadTemplate={onDownloadTemplate}
            templateBusy={templateBusy}
          />
        )}

        {stage.kind === "reading" && (
          <div
            role="status"
            className="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"
          >
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Membaca {stage.fileName}...
          </div>
        )}

        {stage.kind === "preview" && <PreviewStep rows={stage.rows} />}

        {stage.kind === "importing" && (
          <div role="status" aria-live="polite" className="py-10">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Menyimpan produk... {stage.done} dari {stage.total}
            </p>
            <div
              role="progressbar"
              aria-label="Progres impor produk"
              aria-valuemin={0}
              aria-valuemax={stage.total}
              aria-valuenow={stage.done}
              className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            >
              <div
                className="h-full bg-lco-green transition-[width] duration-150 motion-reduce:transition-none dark:bg-lco-teal"
                style={{ width: `${stage.total ? (stage.done / stage.total) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              Jangan tutup jendela ini sampai selesai.
            </p>
          </div>
        )}

        {stage.kind === "done" && <DoneStep outcomes={stage.outcomes} skipped={stage.skipped} />}
      </div>

      {stage.kind === "pick" && (
        <Footer>
          <Button type="button" variant="secondary" size="lg" onClick={handleClose}>
            Batal
          </Button>
        </Footer>
      )}

      {stage.kind === "preview" && (
        <Footer>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => setStage({ kind: "pick", error: null })}
          >
            Pilih file lain
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={summarizeImport(stage.rows).valid === 0}
            onClick={() => void startImport(stage.rows)}
          >
            Impor {summarizeImport(stage.rows).valid} produk
          </Button>
        </Footer>
      )}

      {stage.kind === "done" && (
        <Footer>
          <Button type="button" size="lg" onClick={handleClose}>
            Selesai
          </Button>
        </Footer>
      )}
    </Modal>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      {children}
    </div>
  );
}

function PickStep({
  error,
  branchName,
  categoryCount,
  onFileChange,
  onDownloadTemplate,
  templateBusy,
}: {
  error: string | null;
  branchName: string | null;
  categoryCount: number;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
  templateBusy: boolean;
}) {
  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-lco-coral/30 bg-lco-coral/10 px-4 py-3 text-sm text-lco-coral"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          Pakai file dari template. Kolom bertanda * wajib diisi, SKU harus unik, dan satu file
          maksimal {MAX_IMPORT_ROWS} produk.
        </p>
        <p>Barcode yang dikosongkan dibuat otomatis oleh sistem dan bisa dicetak di menu Label.</p>
        {categoryCount === 0 && (
          <p>
            Belum ada kategori aktif, jadi kolom Kategori di template tidak punya dropdown. Buat
            kategori di tab Kategori bila diperlukan, lalu unduh template lagi.
          </p>
        )}
        {branchName && (
          <p>Produk dipasang di outlet {branchName} dengan stok awal sesuai file.</p>
        )}
      </div>

      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-lco-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 focus-within:ring-2 focus-within:ring-lco-teal focus-within:ring-offset-2 hover:bg-lco-green-hover dark:focus-within:ring-offset-zinc-950">
        <input type="file" accept=".xlsx" onChange={onFileChange} className="sr-only" />
        <Upload className="h-4 w-4" aria-hidden="true" />
        Pilih file Excel
      </label>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-200 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <span>Belum punya template?</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDownloadTemplate}
          disabled={templateBusy}
        >
          {templateBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Download template
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({ rows }: { rows: ImportRow[] }) {
  const summary = summarizeImport(rows);
  const problems = rows.filter((row) => !row.product);
  const ready = rows.filter(
    (row): row is ImportRow & { product: ParsedProduct } => row.product !== null,
  );

  return (
    <div className="space-y-5">
      <div role="status">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {summary.valid} dari {summary.total} baris siap diimpor.
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {summary.invalid > 0
            ? `${summary.invalid} baris bermasalah akan dilewati. Perbaiki di Excel lalu unggah ulang.`
            : "Tidak ada baris bermasalah."}
          {summary.autoBarcodes > 0
            ? ` ${summary.autoBarcodes} barcode dibuat otomatis.`
            : ""}
        </p>
      </div>

      {problems.length > 0 && (
        <section aria-label="Baris bermasalah">
          <h3 className="mb-2 text-sm font-semibold text-lco-coral">Perlu diperbaiki</h3>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-lco-coral/30 p-3 text-sm">
            {problems.map((row) => (
              <li key={row.rowNumber}>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Baris {row.rowNumber}: {row.label}
                </p>
                <p className="break-words text-lco-coral">{row.errors.join(" ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready.length > 0 && (
        <section aria-label="Baris siap diimpor">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Siap diimpor
          </h3>
          <div className="max-h-72 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th className={headCellClass}>Baris</th>
                  <th className={headCellClass}>Produk</th>
                  <th className={headCellClass}>Kategori</th>
                  <th className={headCellClass}>Barcode</th>
                  <th className={`${headCellClass} text-right`}>Harga Jual</th>
                  <th className={`${headCellClass} text-right`}>Stok</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {ready.map((row) => {
                  const { product } = row;
                  return (
                    <tr key={row.rowNumber}>
                      <td className="px-3 py-2 font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {row.rowNumber}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{product.name}</p>
                        <p className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                          {product.sku}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                        {product.categoryName || "Tanpa kategori"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {product.barcode}
                        {product.barcodeAuto && (
                          <span className="ml-1.5 font-sans text-zinc-600 dark:text-zinc-400">
                            (otomatis)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatRupiah(product.sellPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {product.type === "JASA" ? "Tanpa stok" : product.stock}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function DoneStep({ outcomes, skipped }: { outcomes: ImportOutcome[]; skipped: number }) {
  const saved = outcomes.filter((outcome) => outcome.success);
  const failed = outcomes.filter((outcome) => !outcome.success);
  const warnings = saved.filter((outcome) => outcome.warning);

  return (
    <div className="space-y-5" role="status">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {saved.length} produk berhasil ditambahkan.
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {failed.length > 0 ? `${failed.length} produk gagal disimpan. ` : ""}
          {skipped > 0 ? `${skipped} baris dilewati karena bermasalah. ` : ""}
          {failed.length === 0 && skipped === 0 ? "Semua baris tersimpan." : ""}
        </p>
      </div>

      {failed.length > 0 && (
        <section aria-label="Produk gagal disimpan">
          <h3 className="mb-2 text-sm font-semibold text-lco-coral">Gagal disimpan</h3>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-lco-coral/30 p-3 text-sm">
            {failed.map((outcome) => (
              <li key={outcome.rowNumber}>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Baris {outcome.rowNumber}: {outcome.label}
                </p>
                <p className="break-words text-lco-coral">{outcome.error}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section aria-label="Produk tersimpan dengan catatan">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Tersimpan dengan catatan
          </h3>
          <ul className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            {warnings.map((outcome) => (
              <li key={outcome.rowNumber}>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Baris {outcome.rowNumber}: {outcome.label}
                </p>
                <p className="break-words text-zinc-600 dark:text-zinc-400">{outcome.warning}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
