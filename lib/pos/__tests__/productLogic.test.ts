import { beforeEach, describe, expect, it, vi } from "vitest";

// productLogic membuat klien Supabase saat modul dimuat, jadi klien itu
// diganti tiruan sederhana. Yang diuji: validasi input dan bentuk data yang
// dikirim ke database — bukan Supabase-nya.
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: { code?: string; message: string } | null };
  const state = {
    insertPayload: undefined as Record<string, unknown> | undefined,
    updatePayload: undefined as Record<string, unknown> | undefined,
    writeCalls: 0,
    writeResult: { data: { id: "p1" }, error: null } as Result,
    stockResult: { data: { stock: 0 }, error: null } as Result,
    rpcResult: { data: { success: true }, error: null } as Result,
    rpcCall: undefined as { name: string; args: Record<string, unknown> } | undefined,
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    rpcQueue: [] as Result[],
  };
  function makeChain() {
    let op: "select" | "insert" | "update" = "select";
    const chain = {
      insert(payload: Record<string, unknown>) {
        op = "insert";
        state.writeCalls += 1;
        state.insertPayload = payload;
        return chain;
      },
      update(payload: Record<string, unknown>) {
        op = "update";
        state.writeCalls += 1;
        state.updatePayload = payload;
        return chain;
      },
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      single() {
        return Promise.resolve(op === "select" ? state.stockResult : state.writeResult);
      },
    };
    return chain;
  }
  return { state, makeChain };
});

vi.mock("../../supabase/client", () => ({
  createClient: () => ({
    from: () => h.makeChain(),
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCall = { name, args };
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve(h.state.rpcQueue.shift() ?? h.state.rpcResult);
    },
  }),
}));

vi.mock("../productCodesApi", () => ({
  generateUniqueBarcode: vi.fn(),
}));

import { generateUniqueBarcode } from "../productCodesApi";
import {
  createProduct,
  deleteProduct,
  restoreProduct,
  updateProduct,
  type CreateProductInput,
} from "../productLogic";

const valid: CreateProductInput = {
  name: "Kaos Polos",
  sku: "kp-001",
  barcode: "8990001",
  type: "FASHION",
  category_id: "cat-1",
  unit: "pcs",
  sell_price: 75_000,
  cost_price: 40_000,
  stock: 10,
  min_stock: 2,
  photo_url: "",
  is_active: true,
};

beforeEach(() => {
  h.state.insertPayload = undefined;
  h.state.updatePayload = undefined;
  h.state.writeCalls = 0;
  h.state.writeResult = { data: { id: "p1" }, error: null };
  h.state.stockResult = { data: { stock: 0 }, error: null };
  h.state.rpcResult = { data: { success: true }, error: null };
  h.state.rpcCall = undefined;
  h.state.rpcCalls = [];
  h.state.rpcQueue = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(generateUniqueBarcode).mockReset();
  vi.mocked(generateUniqueBarcode).mockResolvedValue({
    success: true,
    barcode: "2000000000015",
  });
});

describe("createProduct — validasi", () => {
  const cases: [string, Partial<CreateProductInput>, string][] = [
    ["nama kosong", { name: "   " }, "Nama produk wajib diisi."],
    ["SKU kosong", { sku: " " }, "SKU wajib diisi."],
    ["harga jual 0", { sell_price: 0 }, "Harga jual harus lebih dari 0."],
    ["harga jual negatif", { sell_price: -1 }, "Harga jual harus lebih dari 0."],
    ["harga modal negatif", { cost_price: -1 }, "Harga modal tidak boleh negatif."],
    ["stok negatif", { stock: -1 }, "Stok tidak boleh negatif."],
    ["minimum stok negatif", { min_stock: -1 }, "Minimum stok tidak boleh negatif."],
  ];

  for (const [name, patch, error] of cases) {
    it(`menolak ${name} tanpa menyentuh database`, async () => {
      const result = await createProduct({ ...valid, ...patch });
      expect(result).toEqual({ success: false, error });
      expect(h.state.writeCalls).toBe(0);
    });
  }
});

describe("createProduct — data yang disimpan", () => {
  it("nama dirapikan, SKU jadi huruf besar, field kosong jadi null", async () => {
    const result = await createProduct({
      ...valid,
      name: "  Kaos Polos ",
      sku: " kp-001 ",
      barcode: "  ",
      category_id: "",
      unit: " ",
      photo_url: " ",
    });
    expect(result).toEqual({ success: true, product: { id: "p1" } });
    expect(h.state.insertPayload).toMatchObject({
      name: "Kaos Polos",
      sku: "KP-001",
      barcode: "2000000000015",
      category_id: null,
      unit: null,
      photo_url: null,
    });
  });

  it("harga modal 0 disimpan null; is_extra_charge default false", async () => {
    await createProduct({ ...valid, cost_price: 0 });
    expect(h.state.insertPayload?.cost_price).toBeNull();
    expect(h.state.insertPayload?.is_extra_charge).toBe(false);
  });

  it("produk JASA: is_service true, stok dan minimum stok dipaksa 0", async () => {
    await createProduct({ ...valid, type: "JASA", stock: 50, min_stock: 5 });
    expect(h.state.insertPayload).toMatchObject({
      type: "JASA",
      is_service: true,
      stock: 0,
      min_stock: 0,
    });
  });

  it("produk fisik: stok dan minimum stok dipertahankan", async () => {
    await createProduct(valid);
    expect(h.state.insertPayload).toMatchObject({
      is_service: false,
      stock: 10,
      min_stock: 2,
    });
  });
});

describe("createProduct — barcode otomatis", () => {
  it("barcode kosong diisi hasil generator", async () => {
    await createProduct({ ...valid, barcode: "" });
    expect(generateUniqueBarcode).toHaveBeenCalledTimes(1);
    expect(h.state.insertPayload?.barcode).toBe("2000000000015");
  });

  it("barcode isian pengguna dipakai apa adanya tanpa memanggil generator", async () => {
    await createProduct({ ...valid, barcode: " 8990001 " });
    expect(generateUniqueBarcode).not.toHaveBeenCalled();
    expect(h.state.insertPayload?.barcode).toBe("8990001");
  });

  it("generator gagal -> error, produk tidak disimpan", async () => {
    vi.mocked(generateUniqueBarcode).mockResolvedValue({ success: false, error: "koneksi putus" });
    const result = await createProduct({ ...valid, barcode: "" });
    expect(result).toEqual({
      success: false,
      error: "Barcode otomatis gagal dibuat: koneksi putus",
    });
    expect(h.state.writeCalls).toBe(0);
  });

  it("validasi gagal tidak membuang barcode otomatis", async () => {
    await createProduct({ ...valid, barcode: "", name: " " });
    expect(generateUniqueBarcode).not.toHaveBeenCalled();
  });
});

describe("createProduct — error database", () => {
  it("SKU duplikat (kode 23505) -> pesan ramah", async () => {
    h.state.writeResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    expect(await createProduct(valid)).toEqual({
      success: false,
      error: "SKU tersebut sudah digunakan. Gunakan SKU yang berbeda.",
    });
  });

  it("error lain -> pesan aslinya diteruskan", async () => {
    h.state.writeResult = { data: null, error: { code: "XX000", message: "koneksi putus" } };
    expect(await createProduct(valid)).toEqual({ success: false, error: "koneksi putus" });
  });
});

describe("updateProduct", () => {
  const { stock: _stock, ...withoutStock } = valid;
  void _stock;
  const update = { ...withoutStock, id: "p1" };

  it("tidak pernah mengirim kolom stock (stok hanya berubah lewat RPC)", async () => {
    const result = await updateProduct(update);
    expect(result).toEqual({ success: true, product: { id: "p1" } });
    expect(h.state.updatePayload).toBeDefined();
    expect(h.state.updatePayload).not.toHaveProperty("stock");
  });

  it("validasi sama seperti tambah produk", async () => {
    expect(await updateProduct({ ...update, name: "" })).toEqual({
      success: false,
      error: "Nama produk wajib diisi.",
    });
    expect(await updateProduct({ ...update, sell_price: 0 })).toMatchObject({ success: false });
    expect(h.state.writeCalls).toBe(0);
  });

  it("mengubah produk berstok menjadi JASA ditolak, pesan menyebut jumlah stok", async () => {
    h.state.stockResult = { data: { stock: 7 }, error: null };
    const result = await updateProduct({ ...update, type: "JASA" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("stok 7");
    expect(h.state.writeCalls).toBe(0);
  });

  it("mengubah produk bestok 0 menjadi JASA diizinkan; min_stock jadi 0", async () => {
    h.state.stockResult = { data: { stock: 0 }, error: null };
    const result = await updateProduct({ ...update, type: "JASA", min_stock: 5 });
    expect(result.success).toBe(true);
    expect(h.state.updatePayload).toMatchObject({ is_service: true, min_stock: 0 });
  });

  it("gagal membaca stok saat ubah ke JASA -> error diteruskan, tidak menulis", async () => {
    h.state.stockResult = { data: null, error: { message: "tidak bisa baca" } };
    expect(await updateProduct({ ...update, type: "JASA" })).toEqual({
      success: false,
      error: "tidak bisa baca",
    });
    expect(h.state.writeCalls).toBe(0);
  });

  it("SKU duplikat -> pesan ramah", async () => {
    h.state.writeResult = { data: null, error: { code: "23505", message: "dup" } };
    expect(await updateProduct(update)).toEqual({
      success: false,
      error: "SKU tersebut sudah digunakan. Gunakan SKU yang berbeda.",
    });
  });
});

describe("deleteProduct / restoreProduct (RPC)", () => {
  it("deleteProduct memanggil soft_delete_product; alasan dirapikan", async () => {
    expect(await deleteProduct("p1", "  salah input ")).toEqual({ success: true });
    expect(h.state.rpcCall).toEqual({
      name: "soft_delete_product",
      args: { p_product_id: "p1", p_reason: "salah input" },
    });
  });

  it("alasan kosong atau tidak ada dikirim sebagai null", async () => {
    await deleteProduct("p1", "   ");
    expect(h.state.rpcCall?.args.p_reason).toBeNull();
    await deleteProduct("p1");
    expect(h.state.rpcCall?.args.p_reason).toBeNull();
  });

  it("error RPC (mis. bukan admin) -> pesan error diteruskan", async () => {
    h.state.rpcResult = { data: null, error: { message: "Hanya admin" } };
    expect(await deleteProduct("p1")).toEqual({ success: false, error: "Hanya admin" });
    expect(await restoreProduct("p1")).toEqual({ success: false, error: "Hanya admin" });
  });

  it("RPC tanpa success -> pesan gagal bawaan", async () => {
    h.state.rpcResult = { data: { success: false }, error: null };
    expect(await deleteProduct("p1")).toEqual({ success: false, error: "Produk gagal dihapus." });
    expect(await restoreProduct("p1")).toEqual({ success: false, error: "Produk gagal dipulihkan." });
  });

  it("restoreProduct memanggil restore_product", async () => {
    expect(await restoreProduct("p9")).toEqual({ success: true });
    expect(h.state.rpcCall).toEqual({ name: "restore_product", args: { p_product_id: "p9" } });
  });
});

describe("createProduct — dipasang di outlet aktif (pusat)", () => {
  const withBranch: CreateProductInput = { ...valid, branch_id: "pusat-1" };
  const fail = { data: null, error: { message: "Mengisi stok awal butuh izin ubah stok" } };

  it("memasang produk hanya di outlet aktif dengan stok awal dari form", async () => {
    const res = await createProduct(withBranch);
    expect(res.success).toBe(true);
    expect((res as { warning?: string }).warning).toBeUndefined();
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.state.rpcCalls[0].name).toBe("assign_product_branch");
    expect(h.state.rpcCalls[0].args).toMatchObject({
      p_product_id: "p1",
      p_branch_id: "pusat-1",
      p_stock: 10,
      p_min_stock: 2,
    });
    expect(h.state.insertPayload?.stock).toBe(0);
  });

  it("gagal pasang dengan stok awal: dicoba ulang tanpa stok supaya produk tetap tampil", async () => {
    h.state.rpcQueue = [fail, { data: { success: true }, error: null }];
    const res = await createProduct(withBranch);
    expect(res.success).toBe(true);
    expect(h.state.rpcCalls).toHaveLength(2);
    expect(h.state.rpcCalls[1].args.p_stock).toBe(0);
    expect((res as { warning?: string }).warning).toContain("stok awal tidak tercatat");
  });

  it("gagal dua kali: produk tersimpan dengan peringatan belum aktif", async () => {
    h.state.rpcQueue = [fail, fail];
    const res = await createProduct(withBranch);
    expect(res.success).toBe(true);
    expect((res as { warning?: string }).warning).toContain("belum aktif di outlet ini");
  });

  it("stok awal 0 yang gagal tidak dicoba ulang", async () => {
    h.state.rpcQueue = [fail];
    const res = await createProduct({ ...withBranch, stock: 0 });
    expect(h.state.rpcCalls).toHaveLength(1);
    expect((res as { warning?: string }).warning).toContain("belum aktif di outlet ini");
  });

  it("tanpa branch_id tidak memanggil RPC outlet", async () => {
    await createProduct(valid);
    expect(h.state.rpcCalls).toHaveLength(0);
  });
});
