// Barcode otomatis produk: EAN-13 berawalan 20. Awalan 20 sampai 29 dicadangkan
// GS1 untuk pemakaian dalam toko, jadi tidak bentrok dengan barcode pabrikan.
// Hanya angka, sehingga bisa dicetak sebagai Code128 di menu Label dan dipindai
// kasir tanpa pengaturan tambahan.

const PREFIX = "20";
const BODY_DIGITS = 10;
const MAX_ATTEMPTS = 100;

export const BARCODE_MAX_LENGTH = 48;

export type RandomDigit = () => number;

// Nilai di atas kelipatan 10 terbesar dibuang supaya setiap digit sama peluangnya.
function randomDigit(): number {
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= 4_294_967_290);
  return buffer[0] % 10;
}

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) {
    throw new Error("EAN-13 butuh 12 digit angka.");
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Membuat satu barcode baru yang belum ada di `taken`. `digit` bisa diganti
 * di test supaya hasilnya deterministik.
 */
export function generateBarcode(
  taken: ReadonlySet<string> = new Set(),
  digit: RandomDigit = randomDigit,
): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let body = "";
    for (let i = 0; i < BODY_DIGITS; i += 1) body += digit();
    const first12 = PREFIX + body;
    const code = first12 + ean13CheckDigit(first12);
    if (!taken.has(code)) return code;
  }
  throw new Error("Gagal membuat barcode unik. Coba lagi.");
}

/**
 * Pesan error untuk barcode isian pengguna, null kalau layak. Aturannya mengikuti
 * Code128 subset B yang dipakai menu Label: ASCII tercetak, tanpa spasi.
 */
export function barcodeTextError(text: string): string | null {
  if (text.length > BARCODE_MAX_LENGTH) {
    return `Barcode terlalu panjang (maksimal ${BARCODE_MAX_LENGTH} karakter).`;
  }
  if (!/^[\x21-\x7E]+$/.test(text)) {
    return "Barcode hanya boleh berisi huruf, angka, dan simbol biasa tanpa spasi.";
  }
  return null;
}

// Excel menulis angka panjang sebagai 8.99E+12 kalau kolomnya bukan teks. Tanda "+"
// wajib supaya kode asli seperti "2E10" tidak ikut terdeteksi.
export function looksLikeScientific(text: string): boolean {
  return /^\d+(\.\d+)?E\+\d+$/i.test(text.trim());
}
