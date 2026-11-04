import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLE_PRINTER_SERVICE_CANDIDATES,
  GENERIC_BLE_PRINTER_CHARACTERISTIC,
  GENERIC_BLE_PRINTER_SERVICE,
  buildReceiptBytes,
  buildTestPrintBytes,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  getAuthorizedUsbDevices,
  getPairedBluetoothDevices,
  isWebBluetoothSupported,
  isWebUsbSupported,
  reconnectBluetoothPrinter,
  requestBluetoothPrinter,
  requestUsbPrinter,
  writeToBluetoothPrinter,
  writeToUsbPrinter,
  type MinimalBluetoothDevice,
  type MinimalBluetoothRemoteGATTCharacteristic,
  type MinimalUsbDevice,
} from "../printerConnection";
import type { ReceiptData } from "../printLogic";

// ═════════════════════════════ Pembuat byte ESC/POS ═════════════════════════════
// Decoder mini: memecah byte jadi baris teks + log perintah, supaya isi struk
// bisa diperiksa per baris tanpa tercampur byte kontrol.
const ESC = 0x1b;
const GS = 0x1d;

interface Decoded {
  lines: string[];
  commands: string[];
  bytes: Uint8Array;
}

function decode(bytes: Uint8Array): Decoded {
  const lines: string[] = [];
  const commands: string[] = [];
  let buf: number[] = [];
  const flush = () => {
    lines.push(new TextDecoder().decode(new Uint8Array(buf)));
    buf = [];
  };
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b === 0x0a) {
      flush();
      i++;
    } else if (b === ESC) {
      const c = bytes[i + 1];
      if (c === 0x40) { commands.push("ESC @"); i += 2; }
      else if (c === 0x61) { commands.push(`ESC a ${bytes[i + 2]}`); i += 3; }
      else if (c === 0x21) { commands.push(`ESC ! ${bytes[i + 2]}`); i += 3; }
      else if (c === 0x45) { commands.push(`ESC E ${bytes[i + 2]}`); i += 3; }
      else if (c === 0x4a) { commands.push(`ESC J ${bytes[i + 2]}`); i += 3; }
      else throw new Error(`ESC tak dikenal: ${c} @${i}`);
    } else if (b === GS) {
      const c = bytes[i + 1];
      if (c === 0x56) { commands.push(`GS V ${bytes[i + 2]} ${bytes[i + 3]}`); i += 4; }
      else if (c === 0x68) { commands.push(`GS h ${bytes[i + 2]}`); i += 3; }
      else if (c === 0x77) { commands.push(`GS w ${bytes[i + 2]}`); i += 3; }
      else if (c === 0x48) { commands.push(`GS H ${bytes[i + 2]}`); i += 3; }
      else if (c === 0x6b) {
        const len = bytes[i + 3];
        const data = new TextDecoder().decode(bytes.slice(i + 4, i + 4 + len));
        commands.push(`GS k ${bytes[i + 2]} ${data}`);
        i += 4 + len;
      } else if (c === 0x76) {
        // GS v 0 m xL xH yL yH d... (raster) — lewati data bitmap
        const xBytes = bytes[i + 4] + bytes[i + 5] * 256;
        const yDots = bytes[i + 6] + bytes[i + 7] * 256;
        commands.push(`GS v 0 ${xBytes}x${yDots}`);
        i += 8 + xBytes * yDots;
      } else throw new Error(`GS tak dikenal: ${c} @${i}`);
    } else {
      buf.push(b);
      i++;
    }
  }
  if (buf.length) flush();
  return { lines, commands, bytes };
}

const sale: ReceiptData = {
  receiptNo: "LCO-STR/26/11/000001",
  createdAt: "2026-11-05T03:00:00.000Z",
  cashierName: "Sari",
  items: [
    { name: "Kaos Polos", qty: 2, price: 50_000 },
    { name: "Stiker", qty: 3, price: 1_500, subtotal: 4_000 },
  ],
  subtotal: 104_000,
  total: 104_000,
  method: "CASH",
  paidAmount: 150_000,
  changeAmount: 46_000,
};

const textOf = (d: Decoded) => d.lines.join("\n");
const find = (d: Decoded, re: RegExp) => d.lines.find((l) => re.test(l));

describe("buildTestPrintBytes", () => {
  const d = decode(buildTestPrintBytes("Toko Maju", "Printer 1"));

  it("diawali reset printer dan diakhiri feed + potong kertas", () => {
    expect(d.commands[0]).toBe("ESC @");
    expect(d.commands.slice(-2)).toEqual(["ESC J 160", "GS V 66 0"]);
  });

  it("memuat nama toko, penanda tes, dan nama printer", () => {
    expect(textOf(d)).toContain("Toko Maju");
    expect(textOf(d)).toContain("*** TES PRINT ***");
    expect(find(d, /^Printer\s+: Printer 1$/)).toBeDefined();
    expect(find(d, /^Waktu\s+:/)).toBeDefined();
  });

  it("nama toko kosong -> Langitan.co", () => {
    expect(textOf(decode(buildTestPrintBytes("", "P")))).toContain("Langitan.co");
  });

  it("garis pemisah selebar kertas (48 kolom)", () => {
    expect(d.lines).toContain("-".repeat(48));
  });
});

describe("buildReceiptBytes — struk penjualan", () => {
  it("urutan perintah dasar: reset, ... feed, potong", () => {
    const d = decode(buildReceiptBytes(sale));
    expect(d.commands[0]).toBe("ESC @");
    expect(d.commands.slice(-2)).toEqual(["ESC J 160", "GS V 66 0"]);
  });

  it("tidak ada baris yang melebihi lebar kertas (48 kolom)", () => {
    const d = decode(
      buildReceiptBytes({
        ...sale,
        storeAddress: "Jl. Kenanga Raya No. 12 Blok C Kelurahan Sukamaju Kecamatan Cibinong Kabupaten Bogor",
        customerName: "Pelanggan Dengan Nama Yang Sangat Sangat Panjang Sekali Hingga Turun",
        cashierName: "Kasir Dengan Nama Yang Cukup Panjang Sekali Juga Ya",
        items: [{ name: "Kaos Polos Premium Cotton Combed 30s Lengan Panjang Warna Hitam Ukuran XL", qty: 1, price: 85_000 }],
        footerText: "Terima kasih telah berbelanja, semoga puas dan sampai jumpa lagi di kunjungan berikutnya",
      }),
    );
    for (const line of d.lines) expect(line.length).toBeLessThanOrEqual(48);
  });

  it("header: nama toko, no. struk, kasir, metode (label struk)", () => {
    const d = decode(buildReceiptBytes({ ...sale, storeName: "Toko Maju" }));
    expect(textOf(d)).toContain("Toko Maju");
    expect(find(d, /^No\. Struk : LCO-STR\/26\/11\/000001$/)).toBeDefined();
    expect(find(d, /^Kasir\s+: Sari$/)).toBeDefined();
    expect(find(d, /^Metode\s+: Tunai$/)).toBeDefined();
    expect(find(d, /^Waktu\s+:.*2026/)).toBeDefined();
  });

  it("nama toko kosong -> Langitan.co; kasir kosong -> '-'", () => {
    const d = decode(buildReceiptBytes({ ...sale, cashierName: null }));
    expect(textOf(d)).toContain("Langitan.co");
    expect(find(d, /^Kasir\s+: -$/)).toBeDefined();
  });

  it("alamat & telepon dicetak bila ada, tidak bila kosong", () => {
    const withInfo = decode(buildReceiptBytes({ ...sale, storeAddress: "Jl. Mawar 1", storePhone: "021-555" }));
    expect(textOf(withInfo)).toContain("Jl. Mawar 1");
    expect(textOf(withInfo)).toContain("021-555");
    expect(textOf(decode(buildReceiptBytes(sale)))).not.toContain("021-555");
  });

  it("item: nama, lalu 'qty x harga' rata kiri dan subtotal rata kanan (lebar 48)", () => {
    const d = decode(buildReceiptBytes(sale));
    expect(d.lines).toContain("Kaos Polos");
    const row = find(d, /^2x 50\.000\s+100\.000$/)!;
    expect(row).toBeDefined();
    expect(row).toHaveLength(48);

    // subtotal eksplisit dipakai, bukan qty x harga
    const row2 = find(d, /^3x 1\.500\s+4\.000$/)!;
    expect(row2).toBeDefined();
    expect(row2).toHaveLength(48);
  });

  it("nama item panjang dipecah per kata; kata > 48 karakter dipotong", () => {
    const long = decode(
      buildReceiptBytes({
        ...sale,
        items: [{ name: "Kaos Polos Premium Cotton Combed 30s Lengan Panjang Warna Hitam", qty: 1, price: 1_000 }],
      }),
    );
    const nameLines = long.lines.slice(
      long.lines.findIndex((l) => l.startsWith("Kaos")),
    );
    expect(nameLines[0]).toBe("Kaos Polos Premium Cotton Combed 30s Lengan");
    expect(nameLines[1]).toBe("Panjang Warna Hitam");

    const huge = decode(
      buildReceiptBytes({ ...sale, items: [{ name: "X".repeat(100), qty: 1, price: 1 }] }),
    );
    expect(huge.lines).toContain("X".repeat(48));
    expect(huge.lines).toContain("X".repeat(48));
    expect(huge.lines).toContain("X".repeat(4));
  });

  it("ringkasan: subtotal, total tebal, bayar, kembali", () => {
    const d = decode(buildReceiptBytes(sale));
    expect(find(d, /^Subtotal\s+104\.000$/)).toHaveLength(48);
    expect(find(d, /^Total\s+104\.000$/)).toHaveLength(48);
    expect(find(d, /^Bayar\s+150\.000$/)).toHaveLength(48);
    expect(find(d, /^Kembali\s+46\.000$/)).toHaveLength(48);
    // Total dibungkus bold on/off
    const idx = d.commands.indexOf("ESC E 1");
    expect(idx).toBeGreaterThan(-1);
    expect(d.commands[idx + 1]).toBe("ESC E 0");
  });

  it("diskon (minus) & pajak hanya bila > 0", () => {
    const none = decode(buildReceiptBytes(sale));
    expect(find(none, /^Diskon/)).toBeUndefined();
    expect(find(none, /^Pajak/)).toBeUndefined();

    const both = decode(buildReceiptBytes({ ...sale, discount: 5_000, tax: 2_000 }));
    expect(find(both, /^Diskon\s+-5\.000$/)).toBeDefined();
    expect(find(both, /^Pajak\s+2\.000$/)).toBeDefined();
  });

  it("pelanggan dan cetak ulang tampil bila ada", () => {
    const d = decode(buildReceiptBytes({ ...sale, customerName: "Budi", isReprint: true }));
    expect(find(d, /^Pelanggan : Budi$/)).toBeDefined();
    expect(d.lines).toContain("*** CETAK ULANG ***");
    expect(find(decode(buildReceiptBytes(sale)), /Pelanggan|CETAK ULANG/)).toBeUndefined();
  });

  it("label panjang turun ke baris berikutnya, sejajar dengan nilai", () => {
    const d = decode(
      buildReceiptBytes({ ...sale, customerName: "Pelanggan Dengan Nama Yang Sangat Panjang Sekali Sampai Turun" }),
    );
    const i = d.lines.findIndex((l) => l.startsWith("Pelanggan : "));
    expect(d.lines[i + 1].startsWith(" ".repeat(12))).toBe(true);
  });

  it("footer kustom dan bawaan", () => {
    expect(textOf(decode(buildReceiptBytes({ ...sale, footerText: "Sampai jumpa" })))).toContain("Sampai jumpa");
    expect(textOf(decode(buildReceiptBytes(sale)))).toContain("Terima kasih atas kunjungan Anda");
  });

  it("barcode Code128 subset B dari nomor struk, dengan teks di bawahnya", () => {
    const d = decode(buildReceiptBytes(sale));
    expect(d.commands).toContain("GS h 64");
    expect(d.commands).toContain("GS w 2");
    expect(d.commands).toContain("GS H 2");
    expect(d.commands).toContain("GS k 73 {BLCO-STR/26/11/000001");
  });

  it("tanpa brand & QR: tidak ada perintah raster", () => {
    const d = decode(buildReceiptBytes(sale));
    expect(d.commands.some((c) => c.startsWith("GS v 0"))).toBe(false);
  });

  it("brand: raster dikirim paling awal dan menggantikan nama toko teks", () => {
    // satu pita 24 baris x 48 byte
    const raster = new Uint8Array([
      GS, 0x76, 0x30, 0x00, 48, 0, 24, 0,
      ...new Uint8Array(48 * 24).fill(0xff),
    ]);
    const d = decode(
      buildReceiptBytes({ ...sale, storeName: "Toko Maju" }, { dataUrl: "", width: 384, height: 24, raster }),
    );
    expect(d.commands.indexOf("GS v 0 48x24")).toBeLessThan(d.commands.indexOf("ESC E 1"));
    expect(textOf(d)).not.toContain("Toko Maju");
  });

  it("QR promosi: teks ajakan lalu raster QR, setelah barcode", () => {
    const raster = new Uint8Array([GS, 0x76, 0x30, 0x00, 4, 0, 8, 0, ...new Uint8Array(32)]);
    const qr = { dataUrl: "", width: 32, height: 8, raster } as never;

    const withQr = decode(buildReceiptBytes({ ...sale, promoText: "Ikuti IG kami" }, null, qr));
    expect(textOf(withQr)).toContain("Ikuti IG kami");
    const barcodeIdx = withQr.commands.findIndex((c) => c.startsWith("GS k"));
    expect(withQr.commands.indexOf("GS v 0 4x8")).toBeGreaterThan(barcodeIdx);

    const defaultText = decode(buildReceiptBytes(sale, null, qr));
    expect(textOf(defaultText)).toContain("Scan untuk ikuti kami");

    expect(decode(buildReceiptBytes(sale, null, null)).commands.some((c) => c.startsWith("GS v 0"))).toBe(false);
  });
});

describe("buildReceiptBytes — struk Buka Kasir", () => {
  const shift: ReceiptData = {
    ...sale,
    kind: "shift_open",
    openingCash: 200_000,
    total: 0,
    items: [],
    storeName: "Toko Maju",
  };

  it("layout sendiri: judul, modal awal, paraf, 'bukan bukti penjualan'", () => {
    const d = decode(buildReceiptBytes(shift));
    expect(d.lines).toContain("BUKA KASIR");
    expect(d.lines).toContain("MODAL AWAL KAS");
    expect(d.lines).toContain("Rp 200.000");
    expect(d.lines).toContain("Paraf Kasir");
    expect(d.lines).toContain("(Sari)");
    expect(d.lines).toContain("* BUKAN BUKTI PENJUALAN *");
    expect(find(d, /^Status\s+: SESI DIBUKA$/)).toBeDefined();
    expect(d.lines).toContain("=".repeat(48));
  });

  it("tanpa item, ringkasan pembayaran, maupun barcode", () => {
    const d = decode(buildReceiptBytes(shift));
    expect(find(d, /^(Subtotal|Total|Bayar|Kembali)/)).toBeUndefined();
    expect(d.commands.some((c) => c.startsWith("GS k"))).toBe(false);
  });

  it("openingCash kosong memakai total", () => {
    const d = decode(buildReceiptBytes({ ...shift, openingCash: undefined, total: 75_000 }));
    expect(d.lines).toContain("Rp 75.000");
  });

  it("diakhiri feed + potong kertas", () => {
    const d = decode(buildReceiptBytes(shift));
    expect(d.commands.slice(-2)).toEqual(["ESC J 160", "GS V 66 0"]);
  });
});

// ═════════════════════════════ Bluetooth ═════════════════════════════

interface FakeChar extends MinimalBluetoothRemoteGATTCharacteristic {
  writeValueWithoutResponse: ReturnType<typeof vi.fn>;
  writeValue: ReturnType<typeof vi.fn>;
}

function makeChar(props: { write?: boolean; writeWithoutResponse?: boolean } = { writeWithoutResponse: true }): FakeChar {
  return {
    uuid: "char",
    properties: props,
    writeValueWithoutResponse: vi.fn(async () => {}),
    writeValue: vi.fn(async () => {}),
  };
}

function setNavigator(nav: unknown) {
  vi.stubGlobal("navigator", nav);
}

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dukungan browser", () => {
  it("Web Bluetooth / WebUSB terdeteksi dari navigator", () => {
    setNavigator({});
    expect(isWebBluetoothSupported()).toBe(false);
    expect(isWebUsbSupported()).toBe(false);
    setNavigator({ bluetooth: {}, usb: {} });
    expect(isWebBluetoothSupported()).toBe(true);
    expect(isWebUsbSupported()).toBe(true);
  });

  it("tanpa navigator (server): false", () => {
    vi.unstubAllGlobals();
    // di Node versi baru `navigator` ada tanpa bluetooth/usb -> tetap false
    expect(isWebBluetoothSupported()).toBe(false);
    expect(isWebUsbSupported()).toBe(false);
  });
});

describe("requestBluetoothPrinter & getPairedBluetoothDevices", () => {
  it("tidak didukung -> pesan jelas", async () => {
    setNavigator({});
    await expect(requestBluetoothPrinter()).rejects.toThrow(/tidak mendukung Web Bluetooth/);
  });

  it("meminta perangkat dengan semua service printer kandidat", async () => {
    const device = { id: "d1" };
    const requestDevice = vi.fn(async () => device);
    setNavigator({ bluetooth: { requestDevice } });
    expect(await requestBluetoothPrinter()).toBe(device);
    expect(requestDevice).toHaveBeenCalledWith({
      acceptAllDevices: true,
      optionalServices: BLE_PRINTER_SERVICE_CANDIDATES,
    });
    expect(BLE_PRINTER_SERVICE_CANDIDATES).toContain(GENERIC_BLE_PRINTER_SERVICE);
  });

  it("daftar perangkat terpasang: kosong bila API tak ada atau error", async () => {
    setNavigator({ bluetooth: {} });
    expect(await getPairedBluetoothDevices()).toEqual([]);
    setNavigator({ bluetooth: { getDevices: async () => { throw new Error("x"); } } });
    expect(await getPairedBluetoothDevices()).toEqual([]);
    setNavigator({ bluetooth: { getDevices: async () => [{ id: "a" }] } });
    expect(await getPairedBluetoothDevices()).toEqual([{ id: "a" }]);
  });
});

type FakeService = {
  uuid?: string;
  getCharacteristic?: (c: string) => Promise<MinimalBluetoothRemoteGATTCharacteristic>;
  getCharacteristics?: () => Promise<MinimalBluetoothRemoteGATTCharacteristic[]>;
};

function makeDevice(opts: {
  services?: Record<string, FakeService>;
  connect?: () => Promise<void>;
  noPrimaryServices?: boolean;
}): MinimalBluetoothDevice {
  const services = opts.services ?? {};
  const server = {
    connected: true,
    connect: vi.fn(async () => {
      await opts.connect?.();
      return server;
    }),
    disconnect: vi.fn(),
    getPrimaryService: vi.fn(async (uuid: string) => {
      if (!services[uuid]) throw new Error("service tidak ada");
      return services[uuid];
    }),
    ...(opts.noPrimaryServices
      ? {}
      : {
          getPrimaryServices: vi.fn(async () =>
            Object.entries(services).map(([uuid, s]) => ({ ...s, uuid })),
          ),
        }),
  };
  return {
    id: "dev",
    gatt: server as never,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("connectBluetoothPrinter", () => {
  it("perangkat tanpa GATT ditolak", async () => {
    await expect(connectBluetoothPrinter({ id: "x" } as never)).rejects.toThrow(/tidak ada GATT/);
  });

  it("service generik 18f0 → characteristic 2af1", async () => {
    const char = makeChar();
    const getCharacteristic = vi.fn(async () => char);
    const device = makeDevice({ services: { [GENERIC_BLE_PRINTER_SERVICE]: { getCharacteristic } } });
    expect(await connectBluetoothPrinter(device)).toBe(char);
    expect(getCharacteristic).toHaveBeenCalledWith(GENERIC_BLE_PRINTER_CHARACTERISTIC);
  });

  it("printer non-generik: cari characteristic yang bisa ditulis di service kandidat", async () => {
    const readOnly = makeChar({});
    const writable = makeChar({ writeWithoutResponse: true });
    const device = makeDevice({
      services: {
        "0000ffe0-0000-1000-8000-00805f9b34fb": {
          getCharacteristics: async () => [readOnly, writable],
        },
      },
    });
    expect(await connectBluetoothPrinter(device)).toBe(writable);
  });

  it("service ada tapi tidak ada characteristic tulis -> lanjut ke kandidat berikutnya", async () => {
    const writable = makeChar({ write: true });
    const device = makeDevice({
      services: {
        "49535343-fe7d-4ae5-8fa9-9fafd205e455": { getCharacteristics: async () => [makeChar({})] },
        "6e400001-b5a8-f393-e0a9-e50e24dcca9e": { getCharacteristics: async () => [writable] },
      },
    });
    expect(await connectBluetoothPrinter(device)).toBe(writable);
  });

  it("tidak ada service dikenal: error memuat daftar service yang terlihat", async () => {
    const device = makeDevice({ services: { "1234": { getCharacteristics: async () => [] } } });
    await expect(connectBluetoothPrinter(device)).rejects.toThrow(
      "Service printer tidak dikenali. Service yang terlihat: 1234",
    );
  });

  it("daftar service tak terbaca -> 'tidak terbaca'", async () => {
    const device = makeDevice({ services: {}, noPrimaryServices: true });
    await expect(connectBluetoothPrinter(device)).rejects.toThrow(/tidak terbaca/);
  });

  it("gagal connect GATT: error asli diteruskan", async () => {
    const device = makeDevice({ connect: async () => { throw new Error("Printer mati"); } });
    await expect(connectBluetoothPrinter(device)).rejects.toThrow("Printer mati");
  });
});

describe("reconnectBluetoothPrinter", () => {
  const generic = (char: FakeChar): Record<string, FakeService> => ({
    [GENERIC_BLE_PRINTER_SERVICE]: { getCharacteristic: async () => char },
  });

  it("berhasil langsung: tidak menunggu iklan", async () => {
    const char = makeChar();
    const device = makeDevice({ services: generic(char) });
    device.watchAdvertisements = vi.fn(async () => {});
    expect(await reconnectBluetoothPrinter(device)).toBe(char);
    expect(device.watchAdvertisements).not.toHaveBeenCalled();
  });

  it("gagal pertama, lalu iklan diterima -> coba sekali lagi dan berhasil", async () => {
    const char = makeChar();
    let attempts = 0;
    const device = makeDevice({
      services: generic(char),
      connect: async () => {
        if (++attempts === 1) throw new Error("GATT gagal");
      },
    });
    device.watchAdvertisements = vi.fn(async () => {});
    // saat addEventListener dipanggil, simulasikan iklan datang
    (device.addEventListener as ReturnType<typeof vi.fn>).mockImplementation((_t: string, l: () => void) => {
      queueMicrotask(l);
    });

    expect(await reconnectBluetoothPrinter(device)).toBe(char);
    expect(attempts).toBe(2);
    expect(device.removeEventListener).toHaveBeenCalled();
  });

  it("tidak ada iklan sampai batas waktu -> error 'Printer tidak ditemukan'", async () => {
    vi.useFakeTimers();
    const device = makeDevice({ connect: async () => { throw new Error("GATT gagal"); } });
    device.watchAdvertisements = vi.fn(() => new Promise<void>(() => {}));
    const promise = reconnectBluetoothPrinter(device, 3_000);
    const assertion = expect(promise).rejects.toThrow(/Printer tidak ditemukan/);
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });

  it("browser tanpa watchAdvertisements: error pertama diteruskan", async () => {
    const device = makeDevice({ connect: async () => { throw new Error("GATT gagal"); } });
    await expect(reconnectBluetoothPrinter(device)).rejects.toThrow("GATT gagal");
  });

  it("'Service printer tidak dikenali' tidak dicoba ulang", async () => {
    const device = makeDevice({ services: {} });
    device.watchAdvertisements = vi.fn(async () => {});
    await expect(reconnectBluetoothPrinter(device)).rejects.toThrow(/tidak dikenali/);
    expect(device.watchAdvertisements).not.toHaveBeenCalled();
  });

  it("watchAdvertisements menolak -> errornya diteruskan", async () => {
    const device = makeDevice({ connect: async () => { throw new Error("GATT gagal"); } });
    device.watchAdvertisements = vi.fn(async () => { throw new Error("izin ditolak"); });
    await expect(reconnectBluetoothPrinter(device)).rejects.toThrow("izin ditolak");
  });
});

describe("writeToBluetoothPrinter", () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 256);
  const sent = (c: FakeChar, fn: "writeValueWithoutResponse" | "writeValue") =>
    c[fn].mock.calls.map((call) => (call[0] as Uint8Array).length);

  it("bawaan: potongan 20 byte dengan jeda 5ms antar potongan", async () => {
    vi.useFakeTimers();
    const c = makeChar();
    const p = writeToBluetoothPrinter(c, bytes(45));
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(sent(c, "writeValueWithoutResponse")).toEqual([20, 20, 5]);
    expect(c.writeValue).not.toHaveBeenCalled();
  });

  it("isi byte utuh dan berurutan", async () => {
    vi.useFakeTimers();
    const c = makeChar();
    const p = writeToBluetoothPrinter(c, bytes(50));
    await vi.advanceTimersByTimeAsync(100);
    await p;
    const joined = c.writeValueWithoutResponse.mock.calls.flatMap((call) => Array.from(call[0] as Uint8Array));
    expect(joined).toEqual(Array.from(bytes(50)));
  });

  it("data kosong: tidak ada tulisan", async () => {
    const c = makeChar();
    await writeToBluetoothPrinter(c, new Uint8Array(0));
    expect(c.writeValueWithoutResponse).not.toHaveBeenCalled();
  });

  it("characteristic hanya 'write': pakai writeValue (dengan respons) tanpa jeda", async () => {
    const c = makeChar({ write: true });
    await writeToBluetoothPrinter(c, bytes(45));
    expect(sent(c, "writeValue")).toEqual([20, 20, 5]);
    expect(c.writeValueWithoutResponse).not.toHaveBeenCalled();
  });

  it("mendukung keduanya: pilih writeWithoutResponse (lebih cepat)", async () => {
    vi.useFakeTimers();
    const c = makeChar({ write: true, writeWithoutResponse: true });
    const p = writeToBluetoothPrinter(c, bytes(10));
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(c.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
    expect(c.writeValue).not.toHaveBeenCalled();
  });

  it("penyetelan dari localStorage (ukuran & jeda) dipakai bila valid", async () => {
    const store: Record<string, string> = { epos_ble_chunk: "100", epos_ble_delay: "0" };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null });
    const c = makeChar();
    await writeToBluetoothPrinter(c, bytes(250));
    expect(sent(c, "writeValueWithoutResponse")).toEqual([100, 100, 50]);
  });

  it("penyetelan di luar batas diabaikan (kembali ke bawaan)", async () => {
    vi.useFakeTimers();
    const store: Record<string, string> = { epos_ble_chunk: "5", epos_ble_delay: "999" };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null });
    const c = makeChar();
    const p = writeToBluetoothPrinter(c, bytes(40));
    await vi.advanceTimersByTimeAsync(100); // jeda bawaan 5ms, bukan 999
    await p;
    expect(sent(c, "writeValueWithoutResponse")).toEqual([20, 20]);
  });

  it("localStorage tidak bisa diakses: tetap jalan dengan bawaan", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    const c = makeChar();
    const p = writeToBluetoothPrinter(c, bytes(25));
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(sent(c, "writeValueWithoutResponse")).toEqual([20, 5]);
  });

  it("error saat menulis diteruskan ke pemanggil", async () => {
    const c = makeChar();
    c.writeValueWithoutResponse.mockRejectedValueOnce(new Error("GATT terputus"));
    await expect(writeToBluetoothPrinter(c, bytes(10))).rejects.toThrow("GATT terputus");
  });
});

describe("disconnectBluetoothPrinter", () => {
  it("memutus GATT; error diabaikan; tanpa gatt aman", () => {
    const disconnect = vi.fn();
    disconnectBluetoothPrinter({ gatt: { disconnect } } as never);
    expect(disconnect).toHaveBeenCalledTimes(1);

    expect(() =>
      disconnectBluetoothPrinter({ gatt: { disconnect: () => { throw new Error("x"); } } } as never),
    ).not.toThrow();
    expect(() => disconnectBluetoothPrinter({} as never)).not.toThrow();
  });
});

// ═════════════════════════════ USB ═════════════════════════════

describe("USB: request & daftar perangkat", () => {
  it("requestUsbPrinter: tidak didukung -> pesan jelas", async () => {
    setNavigator({});
    await expect(requestUsbPrinter()).rejects.toThrow(/tidak mendukung WebUSB/);
  });

  it("requestUsbPrinter: meminta tanpa filter", async () => {
    const dev = { vendorId: 1 };
    const requestDevice = vi.fn(async () => dev);
    setNavigator({ usb: { requestDevice } });
    expect(await requestUsbPrinter()).toBe(dev);
    expect(requestDevice).toHaveBeenCalledWith({ filters: [] });
  });

  it("getAuthorizedUsbDevices: [] bila tak didukung / error", async () => {
    setNavigator({});
    expect(await getAuthorizedUsbDevices()).toEqual([]);
    setNavigator({ usb: { getDevices: async () => { throw new Error("x"); } } });
    expect(await getAuthorizedUsbDevices()).toEqual([]);
    setNavigator({ usb: { getDevices: async () => [{ vendorId: 7 }] } });
    expect(await getAuthorizedUsbDevices()).toEqual([{ vendorId: 7 }]);
  });
});

function makeUsb(over: Partial<MinimalUsbDevice> = {}) {
  const dev = {
    vendorId: 1,
    productId: 2,
    opened: true,
    configuration: {
      interfaces: [
        {
          interfaceNumber: 3,
          alternates: [
            { endpoints: [{ direction: "in", endpointNumber: 1 }, { direction: "out", endpointNumber: 5 }] },
          ],
        },
      ],
    },
    open: vi.fn(async function (this: { opened: boolean }) { this.opened = true; }),
    close: vi.fn(async () => {}),
    selectConfiguration: vi.fn(async () => {}),
    claimInterface: vi.fn(async () => {}),
    releaseInterface: vi.fn(async () => {}),
    transferOut: vi.fn(async () => ({ status: "ok" as const, bytesWritten: 0 })),
    ...over,
  };
  return dev as unknown as MockedUsb;
}

type MockFn = ReturnType<typeof vi.fn>;
type MockedUsb = Omit<
  MinimalUsbDevice,
  "open" | "close" | "selectConfiguration" | "claimInterface" | "releaseInterface" | "transferOut"
> & {
  open: MockFn;
  close: MockFn;
  selectConfiguration: MockFn;
  claimInterface: MockFn;
  releaseInterface: MockFn;
  transferOut: MockFn;
};

describe("writeToUsbPrinter", () => {
  const data = new Uint8Array([1, 2, 3]);

  it("alur normal: claim -> kirim ke endpoint OUT -> release", async () => {
    const dev = makeUsb();
    await writeToUsbPrinter(dev, data);
    expect(dev.open).not.toHaveBeenCalled();
    expect(dev.selectConfiguration).not.toHaveBeenCalled();
    expect(dev.claimInterface).toHaveBeenCalledWith(3);
    expect(dev.transferOut).toHaveBeenCalledWith(5, data);
    expect(dev.releaseInterface).toHaveBeenCalledWith(3);

    const order = [dev.claimInterface, dev.transferOut, dev.releaseInterface].map(
      (f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("perangkat belum terbuka -> dibuka dulu", async () => {
    const dev = makeUsb({ opened: false });
    await writeToUsbPrinter(dev, data);
    expect(dev.open).toHaveBeenCalledTimes(1);
  });

  it("belum ada konfigurasi -> memilih konfigurasi 1", async () => {
    const dev = makeUsb();
    const config = dev.configuration;
    (dev as { configuration: unknown }).configuration = null;
    dev.selectConfiguration.mockImplementation(async () => {
      (dev as { configuration: unknown }).configuration = config;
    });
    await writeToUsbPrinter(dev, data);
    expect(dev.selectConfiguration).toHaveBeenCalledWith(1);
    expect(dev.transferOut).toHaveBeenCalled();
  });

  it("tidak ada endpoint OUT: error jelas, tidak ada claim/kirim", async () => {
    const dev = makeUsb({
      configuration: {
        interfaces: [{ interfaceNumber: 0, alternates: [{ endpoints: [{ direction: "in", endpointNumber: 1 }] }] }],
      },
    });
    await expect(writeToUsbPrinter(dev, data)).rejects.toThrow(/Endpoint OUT printer USB/);
    expect(dev.claimInterface).not.toHaveBeenCalled();
    expect(dev.transferOut).not.toHaveBeenCalled();
  });

  it("tanpa interface sama sekali: error yang sama", async () => {
    const dev = makeUsb({ configuration: { interfaces: [] } });
    await expect(writeToUsbPrinter(dev, data)).rejects.toThrow(/Endpoint OUT printer USB/);
  });

  it("interface tetap dilepas walau pengiriman gagal", async () => {
    const dev = makeUsb();
    dev.transferOut.mockRejectedValueOnce(new Error("stall"));
    await expect(writeToUsbPrinter(dev, data)).rejects.toThrow("stall");
    expect(dev.releaseInterface).toHaveBeenCalledWith(3);
  });
});
