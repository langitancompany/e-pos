import { beforeEach, describe, expect, it, vi } from "vitest";

// transactionApi membuat klien Supabase saat modul dimuat, jadi klien itu diganti
// tiruan. Yang diuji: validasi di sisi client, bentuk argumen yang dikirim ke RPC,
// pemetaan hasil RPC ke tipe aplikasi, dan penanganan error. Validasi sebenarnya
// (permission, stok, dsb.) ada di RPC Postgres dan di luar cakupan test ini.
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null };
  const state = {
    rpcResult: { data: { success: true }, error: null } as Result,
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    /** Hasil query .from() berurutan: panggilan ke-1, ke-2, dst. */
    queryResults: [] as Result[],
    queries: [] as {
      table: string;
      select?: string;
      filters: [string, unknown][];
      order?: [string, unknown];
    }[],
  };
  function makeChain(table: string) {
    const q: (typeof state.queries)[number] = { table, filters: [] };
    state.queries.push(q);
    const result = () =>
      Promise.resolve(state.queryResults.shift() ?? { data: null, error: null });
    const chain = {
      select(s: string) {
        q.select = s;
        return chain;
      },
      eq(col: string, val: unknown) {
        q.filters.push([col, val]);
        return chain;
      },
      order(col: string, opts: unknown) {
        q.order = [col, opts];
        // query daftar retur berakhir di .order() (di-await langsung)
        return result();
      },
      single: () => result(),
      maybeSingle: () => result(),
    };
    return chain;
  }
  return { state, makeChain };
});

vi.mock("../../supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => h.makeChain(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve(h.state.rpcResult);
    },
  }),
}));

import {
  MAX_SPLIT_PAYMENT_LINES,
  createTransaction,
  deleteTransaction,
  getTransactionDetail,
  permanentDeleteTransaction,
  restoreTransaction,
  returnTransaction,
  validateSplitPayments,
  voidTransaction,
  type CreateTransactionParams,
  type SplitPaymentLine,
} from "../transactionApi";
import type { CartItem, Product } from "../types";

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    sku: "SKU-1",
    barcode: null,
    name: "Kaos",
    type: "FASHION",
    is_service: false,
    category_id: null,
    unit: "pcs",
    sell_price: 50_000,
    cost_price: 30_000,
    stock: 10,
    min_stock: 1,
    photo_url: null,
    is_active: true,
    created_at: "",
    updated_at: "",
    deleted_at: null,
    ...over,
  };
}

const cart = (): CartItem[] => [
  { product: product({ id: "p1", sell_price: 50_000 }), qty: 2 },
  { product: product({ id: "p2", sell_price: 25_000 }), qty: 1 },
];

// subtotal keranjang di atas = 2*50.000 + 25.000
const TOTAL = 125_000;

const singleCash = (over: Record<string, unknown> = {}) =>
  ({
    items: cart(),
    subtotal: TOTAL,
    total: TOTAL,
    paymentMethod: "CASH",
    paymentAmount: TOTAL,
    receivedAmount: 150_000,
    ...over,
  }) as CreateTransactionParams;

const rpcOk = (extra: Record<string, unknown> = {}) => ({
  data: {
    success: true,
    transaction_id: "trx-1",
    receipt_no: "INV-001",
    payment_id: "pay-1",
    change_amount: 25_000,
    ...extra,
  },
  error: null,
});

const lastRpc = () => h.state.rpcCalls[h.state.rpcCalls.length - 1];

beforeEach(() => {
  h.state.rpcResult = { data: { success: true }, error: null };
  h.state.rpcCalls = [];
  h.state.queryResults = [];
  h.state.queries = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ───────────────────────── validateSplitPayments ─────────────────────────

describe("validateSplitPayments", () => {
  const cash = (amount: number, received = amount): SplitPaymentLine => ({
    method: "CASH",
    amount,
    receivedAmount: received,
  });
  const digital = (amount: number): SplitPaymentLine => ({
    method: "DIGITAL",
    amount,
  });
  const tempo = (amount: number, dueDate = "2026-12-01"): SplitPaymentLine => ({
    method: "TEMPO",
    amount,
    dueDate,
  });

  it("batas maksimal baris sama dengan RPC (4)", () => {
    expect(MAX_SPLIT_PAYMENT_LINES).toBe(4);
  });

  it("menolak daftar kosong", () => {
    expect(validateSplitPayments(100, [])).toBe("Rincian pembayaran masih kosong.");
  });

  it("menolak lebih dari batas baris", () => {
    const lines = Array.from({ length: 5 }, () => digital(10));
    expect(validateSplitPayments(50, lines)).toMatch(/Maksimal 4/);
  });

  it("menolak total nol atau negatif", () => {
    expect(validateSplitPayments(0, [digital(10)])).toMatch(/lebih dari nol/);
    expect(validateSplitPayments(-5, [digital(10)])).toMatch(/lebih dari nol/);
  });

  it("menolak metode yang dipakai dua kali", () => {
    expect(validateSplitPayments(100, [cash(50), cash(50)])).toBe(
      "Metode CASH dipakai lebih dari sekali.",
    );
  });

  it("menolak nominal nol, negatif, atau desimal", () => {
    expect(validateSplitPayments(100, [digital(0)])).toMatch(/bilangan bulat/);
    expect(validateSplitPayments(100, [digital(-10)])).toMatch(/bilangan bulat/);
    expect(validateSplitPayments(100, [digital(10.5)])).toMatch(/bilangan bulat/);
  });

  it("CASH wajib punya uang diterima yang cukup", () => {
    expect(
      validateSplitPayments(100, [{ method: "CASH", amount: 100 }]),
    ).toMatch(/tunai yang diterima kurang/);
    expect(validateSplitPayments(100, [cash(100, 99)])).toMatch(
      /tunai yang diterima kurang/,
    );
  });

  it("CASH boleh diterima lebih besar dari porsinya (ada kembalian)", () => {
    expect(validateSplitPayments(100, [cash(100, 200)])).toBeNull();
  });

  it("TEMPO wajib jatuh tempo", () => {
    expect(
      validateSplitPayments(100, [{ method: "TEMPO", amount: 100 }], "Budi"),
    ).toMatch(/jatuh tempo/);
  });

  it("TEMPO wajib nama pelanggan (kosong / spasi ditolak)", () => {
    expect(validateSplitPayments(100, [tempo(100)])).toMatch(/Nama pelanggan/);
    expect(validateSplitPayments(100, [tempo(100)], "   ")).toMatch(/Nama pelanggan/);
    expect(validateSplitPayments(100, [tempo(100)], "Budi")).toBeNull();
  });

  it("jumlah kurang dari total ditolak", () => {
    expect(validateSplitPayments(100, [cash(40), digital(50)])).toBe(
      "Jumlah pembayaran masih kurang dari total.",
    );
  });

  it("jumlah melebihi total ditolak", () => {
    expect(validateSplitPayments(100, [cash(60), digital(50)])).toBe(
      "Jumlah pembayaran melebihi total.",
    );
  });

  it("kombinasi valid: tunai + digital + piutang", () => {
    expect(
      validateSplitPayments(100, [cash(30, 50), digital(30), tempo(40)], "Budi"),
    ).toBeNull();
  });

  it("satu baris yang pas dengan total valid", () => {
    expect(validateSplitPayments(100, [digital(100)])).toBeNull();
  });
});

// ───────────────────────── createTransaction ─────────────────────────

describe("createTransaction — validasi sebelum RPC", () => {
  async function rejects(params: CreateTransactionParams, msg: RegExp | string) {
    await expect(createTransaction(params)).rejects.toThrow(msg);
    expect(h.state.rpcCalls).toHaveLength(0); // gagal cepat, tidak ke server
  }

  it("keranjang kosong", async () => {
    await rejects(singleCash({ items: [] }), "Keranjang masih kosong.");
  });

  it("total negatif", async () => {
    await rejects(singleCash({ total: -1 }), "Total transaksi tidak valid.");
  });

  it("nominal pembayaran negatif", async () => {
    await rejects(singleCash({ paymentAmount: -1 }), "Nominal pembayaran tidak valid.");
  });

  it("CASH tanpa uang diterima", async () => {
    await rejects(
      singleCash({ receivedAmount: undefined }),
      "Nominal uang tunai tidak mencukupi.",
    );
  });

  it("CASH dengan uang diterima kurang dari total", async () => {
    await rejects(
      singleCash({ receivedAmount: TOTAL - 1 }),
      "Nominal uang tunai tidak mencukupi.",
    );
  });

  it("TEMPO tanpa nama pelanggan", async () => {
    await rejects(
      singleCash({ paymentMethod: "TEMPO", customerName: "  ", dueDate: "2026-12-01" }),
      "Nama pelanggan wajib diisi untuk piutang.",
    );
  });

  it("TEMPO tanpa jatuh tempo", async () => {
    await rejects(
      singleCash({ paymentMethod: "TEMPO", customerName: "Budi" }),
      "Tanggal jatuh tempo wajib diisi untuk piutang.",
    );
  });

  it("split: meneruskan pesan dari validateSplitPayments", async () => {
    await rejects(
      {
        items: cart(),
        subtotal: TOTAL,
        total: TOTAL,
        payments: [{ method: "DIGITAL", amount: TOTAL - 1 }],
      },
      "Jumlah pembayaran masih kurang dari total.",
    );
  });

  it("digitalOrderId tanpa pembayaran digital (tunggal)", async () => {
    await rejects(
      singleCash({ digitalOrderId: "ORD-1" }),
      /tidak memiliki pembayaran Digital/,
    );
  });

  it("digitalOrderId tanpa baris DIGITAL (split)", async () => {
    await rejects(
      {
        items: cart(),
        subtotal: TOTAL,
        total: TOTAL,
        digitalOrderId: "ORD-1",
        payments: [{ method: "CASH", amount: TOTAL, receivedAmount: TOTAL }],
      },
      /tidak memiliki pembayaran Digital/,
    );
  });

  it("poin dipakai negatif atau desimal", async () => {
    await rejects(singleCash({ pointsRedeemed: -1 }), "Jumlah poin yang dipakai tidak valid.");
    await rejects(singleCash({ pointsRedeemed: 1.5 }), "Jumlah poin yang dipakai tidak valid.");
  });

  it("digitalOrderId berisi spasi saja dianggap kosong (tidak memicu validasi digital)", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(singleCash({ digitalOrderId: "   " }));
    expect(lastRpc().name).toBe("create_transaction");
  });
});

describe("createTransaction — argumen RPC", () => {
  it("pembayaran tunggal memakai create_transaction dan field lama", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(
      singleCash({
        discount: 5_000,
        tax: 2_000,
        customerName: "Budi",
        notes: "titip",
        customerPhone: "  0812  ",
        customerId: "cus-1",
        pointsRedeemed: 3,
      }),
    );

    const { name, args } = lastRpc();
    expect(name).toBe("create_transaction");
    expect(args).toMatchObject({
      p_subtotal: TOTAL,
      p_discount: 5_000,
      p_tax: 2_000,
      p_total: TOTAL,
      p_customer_name: "Budi",
      p_notes: "titip",
      p_customer_phone: "0812", // di-trim
      p_customer_id: "cus-1",
      p_points_redeemed: 3,
      p_payment_method: "CASH",
      p_payment_amount: TOTAL,
      p_received_amount: 150_000,
      p_due_date: null,
    });
    expect(args).not.toHaveProperty("p_payments");
    expect(args).not.toHaveProperty("p_order_id");
  });

  it("nilai opsional yang tidak diisi dikirim sebagai default aman", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(singleCash());
    expect(lastRpc().args).toMatchObject({
      p_discount: 0,
      p_tax: 0,
      p_customer_name: null,
      p_notes: null,
      p_customer_phone: null,
      p_customer_id: null,
      p_points_redeemed: 0,
    });
  });

  it("customerPhone spasi saja menjadi null", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(singleCash({ customerPhone: "   " }));
    expect(lastRpc().args.p_customer_phone).toBeNull();
  });

  it("item dikirim dengan harga jual sekarang dan subtotal per baris", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(singleCash());
    expect(lastRpc().args.p_items).toEqual([
      { product_id: "p1", qty: 2, unit_price: 50_000, discount: 0, subtotal: 100_000 },
      { product_id: "p2", qty: 1, unit_price: 25_000, discount: 0, subtotal: 25_000 },
    ]);
  });

  it("TEMPO tunggal mengirim p_due_date dan received_amount null", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(
      singleCash({
        paymentMethod: "TEMPO",
        receivedAmount: undefined,
        customerName: "Budi",
        dueDate: "2026-12-01",
      }),
    );
    expect(lastRpc().args).toMatchObject({
      p_payment_method: "TEMPO",
      p_received_amount: null,
      p_due_date: "2026-12-01",
    });
  });

  it("total 0 (mis. gratis) lolos validasi tunggal CASH", async () => {
    h.state.rpcResult = rpcOk();
    await expect(
      createTransaction(
        singleCash({ total: 0, subtotal: 0, paymentAmount: 0, receivedAmount: 0 }),
      ),
    ).resolves.toBeDefined();
  });

  it("split: kirim p_payments, JANGAN kirim field pembayaran tunggal", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction({
      items: cart(),
      subtotal: TOTAL,
      total: TOTAL,
      customerName: "Budi",
      payments: [
        { method: "CASH", amount: 25_000, receivedAmount: 50_000, dueDate: "x" },
        { method: "DIGITAL", amount: 50_000, receivedAmount: 99, dueDate: "x" },
        { method: "TEMPO", amount: 50_000, receivedAmount: 99, dueDate: "2026-12-01" },
      ],
    });

    const { args } = lastRpc();
    expect(args.p_payments).toEqual([
      // received_amount hanya untuk CASH, due_date hanya untuk TEMPO
      { method: "CASH", amount: 25_000, received_amount: 50_000, due_date: null },
      { method: "DIGITAL", amount: 50_000, received_amount: null, due_date: null },
      { method: "TEMPO", amount: 50_000, received_amount: null, due_date: "2026-12-01" },
    ]);
    for (const k of [
      "p_payment_method",
      "p_payment_amount",
      "p_received_amount",
      "p_due_date",
    ]) {
      expect(args).not.toHaveProperty(k);
    }
  });

  it("digitalOrderId memakai create_transaction_digital + p_order_id (ter-trim)", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction(
      singleCash({
        paymentMethod: "DIGITAL",
        receivedAmount: undefined,
        digitalOrderId: "  ORD-9  ",
        pointsRedeemed: 2,
      }),
    );
    const { name, args } = lastRpc();
    expect(name).toBe("create_transaction_digital");
    expect(args.p_order_id).toBe("ORD-9");
    // argumen lain tetap sama, termasuk poin (migration 038)
    expect(args.p_points_redeemed).toBe(2);
    expect(args.p_payment_method).toBe("DIGITAL");
  });

  it("split dengan baris DIGITAL + digitalOrderId lolos", async () => {
    h.state.rpcResult = rpcOk();
    await createTransaction({
      items: cart(),
      subtotal: TOTAL,
      total: TOTAL,
      digitalOrderId: "ORD-1",
      payments: [
        { method: "CASH", amount: 25_000, receivedAmount: 25_000 },
        { method: "DIGITAL", amount: 100_000 },
      ],
    });
    expect(lastRpc().name).toBe("create_transaction_digital");
  });
});

describe("createTransaction — hasil RPC", () => {
  it("memetakan semua field dan mengubah angka teks menjadi number", async () => {
    h.state.rpcResult = rpcOk({
      payments: [
        { payment_id: "pay-1", method: "CASH", amount: "25000" },
        { payment_id: "pay-2", method: "DIGITAL", amount: 100_000 },
      ],
      change_amount: "25000",
      points_redeemed: "3",
      points_earned: "12",
      points_balance: "40",
    });

    const res = await createTransaction(singleCash());
    expect(res).toEqual({
      success: true,
      transaction_id: "trx-1",
      receipt_no: "INV-001",
      payment_id: "pay-1",
      payments: [
        { payment_id: "pay-1", method: "CASH", amount: 25_000 },
        { payment_id: "pay-2", method: "DIGITAL", amount: 100_000 },
      ],
      change_amount: 25_000,
      points_redeemed: 3,
      points_earned: 12,
      points_balance: 40,
    });
  });

  it("server lama tanpa data payments: fallback 1 baris dari input tunggal", async () => {
    h.state.rpcResult = rpcOk();
    const res = await createTransaction(singleCash({ paymentAmount: 100_000 }));
    expect(res.payments).toEqual([
      { payment_id: "pay-1", method: "CASH", amount: 100_000 },
    ]);
  });

  it("fallback payments untuk split tanpa payments memakai CASH dan total", async () => {
    h.state.rpcResult = rpcOk();
    const res = await createTransaction({
      items: cart(),
      subtotal: TOTAL,
      total: TOTAL,
      payments: [{ method: "DIGITAL", amount: TOTAL }],
    });
    expect(res.payments).toEqual([
      { payment_id: "pay-1", method: "CASH", amount: TOTAL },
    ]);
  });

  it("server lama tanpa field poin: 0 dan saldo null", async () => {
    h.state.rpcResult = rpcOk();
    const res = await createTransaction(singleCash());
    expect(res).toMatchObject({
      points_redeemed: 0,
      points_earned: 0,
      points_balance: null,
    });
  });

  it("saldo poin 0 tetap 0 (bukan null)", async () => {
    h.state.rpcResult = rpcOk({ points_balance: 0 });
    const res = await createTransaction(singleCash());
    expect(res.points_balance).toBe(0);
  });

  it("change_amount kosong menjadi 0", async () => {
    h.state.rpcResult = rpcOk({ change_amount: undefined });
    expect((await createTransaction(singleCash())).change_amount).toBe(0);
  });
});

describe("createTransaction — error dari server", () => {
  it("melempar pesan error RPC apa adanya", async () => {
    h.state.rpcResult = { data: null, error: { message: "Stok tidak cukup" } };
    await expect(createTransaction(singleCash())).rejects.toThrow("Stok tidak cukup");
  });

  it("pesan error kosong memakai pesan default", async () => {
    h.state.rpcResult = { data: null, error: { message: "" } };
    await expect(createTransaction(singleCash())).rejects.toThrow(
      "Gagal menyimpan transaksi.",
    );
  });

  it("success false atau data null ditolak", async () => {
    h.state.rpcResult = { data: { success: false }, error: null };
    await expect(createTransaction(singleCash())).rejects.toThrow(
      "Transaksi gagal disimpan.",
    );
    h.state.rpcResult = { data: null, error: null };
    await expect(createTransaction(singleCash())).rejects.toThrow(
      "Transaksi gagal disimpan.",
    );
  });
});

// ───────────────────────── returnTransaction ─────────────────────────

describe("returnTransaction", () => {
  const params = {
    transactionId: "trx-1",
    items: [{ transactionItemId: "ti-1", qty: 2 }],
    reason: "  rusak  ",
  };

  it("menolak tanpa item", async () => {
    await expect(returnTransaction({ ...params, items: [] })).rejects.toThrow(
      "Pilih minimal 1 item untuk diretur.",
    );
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("menolak alasan kosong atau spasi", async () => {
    await expect(returnTransaction({ ...params, reason: "" })).rejects.toThrow(
      "Alasan retur wajib diisi.",
    );
    await expect(returnTransaction({ ...params, reason: "   " })).rejects.toThrow(
      "Alasan retur wajib diisi.",
    );
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("mengirim argumen RPC dengan nama snake_case dan alasan ter-trim", async () => {
    h.state.rpcResult = {
      data: { success: true, return_transaction_id: "r1", receipt_no: "RET-1" },
      error: null,
    };
    await returnTransaction(params);
    expect(lastRpc()).toEqual({
      name: "return_transaction",
      args: {
        p_transaction_id: "trx-1",
        p_items: [{ transaction_item_id: "ti-1", qty: 2 }],
        p_reason: "rusak",
      },
    });
  });

  it("memetakan rincian refund dan poin; field yang hilang menjadi 0", async () => {
    h.state.rpcResult = {
      data: {
        success: true,
        return_transaction_id: "r1",
        receipt_no: "RET-1",
        refund_amount: "100000",
        refund_cash: "60000",
        refund_digital: 30_000,
        refund_not_recorded: "10000",
        points_reversed: "5",
      },
      error: null,
    };
    expect(await returnTransaction(params)).toEqual({
      success: true,
      return_transaction_id: "r1",
      receipt_no: "RET-1",
      refund_amount: 100_000,
      refund_cash: 60_000,
      refund_digital: 30_000,
      refund_not_recorded: 10_000,
      points_reversed: 5,
      points_returned: 0,
    });
  });

  it("server lama tanpa rincian refund: semuanya 0", async () => {
    h.state.rpcResult = {
      data: { success: true, return_transaction_id: "r1", receipt_no: "RET-1" },
      error: null,
    };
    expect(await returnTransaction(params)).toMatchObject({
      refund_amount: 0,
      refund_cash: 0,
      refund_digital: 0,
      refund_not_recorded: 0,
    });
  });

  it("error RPC dan success false", async () => {
    h.state.rpcResult = { data: null, error: { message: "Sisa qty tidak cukup" } };
    await expect(returnTransaction(params)).rejects.toThrow("Sisa qty tidak cukup");
    h.state.rpcResult = { data: null, error: { message: "" } };
    await expect(returnTransaction(params)).rejects.toThrow("Gagal memproses retur.");
    h.state.rpcResult = { data: { success: false }, error: null };
    await expect(returnTransaction(params)).rejects.toThrow("Retur gagal diproses.");
  });
});

// ───────────────────────── voidTransaction ─────────────────────────

describe("voidTransaction", () => {
  it("menolak alasan kosong atau spasi tanpa memanggil RPC", async () => {
    await expect(voidTransaction({ transactionId: "t", reason: "" })).rejects.toThrow(
      "Alasan void wajib diisi.",
    );
    await expect(voidTransaction({ transactionId: "t", reason: "  " })).rejects.toThrow(
      "Alasan void wajib diisi.",
    );
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("mengirim alasan ter-trim dan mengembalikan id", async () => {
    h.state.rpcResult = { data: { success: true, transaction_id: "t1" }, error: null };
    const res = await voidTransaction({ transactionId: "t1", reason: " salah input " });
    expect(lastRpc()).toEqual({
      name: "void_transaction",
      args: { p_transaction_id: "t1", p_reason: "salah input" },
    });
    expect(res).toEqual({ success: true, transaction_id: "t1" });
  });

  it("error RPC dan success false", async () => {
    h.state.rpcResult = { data: null, error: { message: "Tidak punya akses" } };
    await expect(voidTransaction({ transactionId: "t", reason: "x" })).rejects.toThrow(
      "Tidak punya akses",
    );
    h.state.rpcResult = { data: null, error: { message: "" } };
    await expect(voidTransaction({ transactionId: "t", reason: "x" })).rejects.toThrow(
      "Gagal membatalkan transaksi.",
    );
    h.state.rpcResult = { data: { success: false }, error: null };
    await expect(voidTransaction({ transactionId: "t", reason: "x" })).rejects.toThrow(
      "Void gagal diproses.",
    );
  });
});

// ───────────── deleteTransaction / restore / permanentDelete ─────────────

describe("deleteTransaction (soft delete)", () => {
  it("alasan opsional: ter-trim, atau null kalau kosong", async () => {
    h.state.rpcResult = { data: { success: true, transaction_id: "t1" }, error: null };
    await deleteTransaction({ transactionId: "t1", reason: " dobel " });
    expect(lastRpc()).toEqual({
      name: "soft_delete_transaction",
      args: { p_transaction_id: "t1", p_reason: "dobel" },
    });

    await deleteTransaction({ transactionId: "t1" });
    expect(lastRpc().args.p_reason).toBeNull();
    await deleteTransaction({ transactionId: "t1", reason: "   " });
    expect(lastRpc().args.p_reason).toBeNull();
  });

  it("error RPC dan success false", async () => {
    h.state.rpcResult = { data: null, error: { message: "Hanya admin" } };
    await expect(deleteTransaction({ transactionId: "t" })).rejects.toThrow("Hanya admin");
    h.state.rpcResult = { data: null, error: { message: "" } };
    await expect(deleteTransaction({ transactionId: "t" })).rejects.toThrow(
      "Gagal menghapus transaksi.",
    );
    h.state.rpcResult = { data: { success: false }, error: null };
    await expect(deleteTransaction({ transactionId: "t" })).rejects.toThrow(
      "Transaksi gagal dihapus.",
    );
  });
});

describe("restoreTransaction", () => {
  it("memanggil restore_transaction dan mengembalikan id", async () => {
    h.state.rpcResult = { data: { success: true, transaction_id: "t1" }, error: null };
    expect(await restoreTransaction("t1")).toEqual({ success: true, transaction_id: "t1" });
    expect(lastRpc()).toEqual({
      name: "restore_transaction",
      args: { p_transaction_id: "t1" },
    });
  });

  it("error RPC dan success false", async () => {
    h.state.rpcResult = { data: null, error: { message: "" } };
    await expect(restoreTransaction("t")).rejects.toThrow("Gagal memulihkan transaksi.");
    h.state.rpcResult = { data: { success: false }, error: null };
    await expect(restoreTransaction("t")).rejects.toThrow("Transaksi gagal dipulihkan.");
  });
});

describe("permanentDeleteTransaction", () => {
  it("memanggil permanent_delete_transaction", async () => {
    h.state.rpcResult = { data: { success: true }, error: null };
    await expect(permanentDeleteTransaction("t1")).resolves.toBeUndefined();
    expect(lastRpc()).toEqual({
      name: "permanent_delete_transaction",
      args: { p_transaction_id: "t1" },
    });
  });

  it("error RPC dan success false", async () => {
    h.state.rpcResult = { data: null, error: { message: "" } };
    await expect(permanentDeleteTransaction("t")).rejects.toThrow(
      "Gagal menghapus permanen transaksi.",
    );
    h.state.rpcResult = { data: { success: false }, error: null };
    await expect(permanentDeleteTransaction("t")).rejects.toThrow(
      "Transaksi gagal dihapus permanen.",
    );
  });
});

// ───────────────────────── getTransactionDetail ─────────────────────────

describe("getTransactionDetail", () => {
  const baseRow = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    receipt_no: "INV-1",
    status: "PAID",
    subtotal: 100_000,
    discount: 0,
    tax: 0,
    total: 100_000,
    customer_name: null,
    customer_phone: null,
    notes: null,
    void_reason: null,
    related_transaction_id: null,
    created_at: "2026-11-01T10:00:00Z",
    customer_id: null,
    points_earned: null,
    points_redeemed: null,
    cashier: { full_name: "Sari" },
    transaction_items: [{ id: "i1", product_name: "Kaos", qty: 1 }],
    payments: [
      {
        id: "pay1",
        method: "TEMPO",
        amount: 100_000,
        received_amount: null,
        change_amount: null,
        reference_no: null,
        notes: null,
        due_date: "2026-12-01",
        is_settled: null,
      },
    ],
    ...over,
  });

  it("transaksi PAID biasa: hanya 1 query, retur kosong", async () => {
    h.state.queryResults = [{ data: baseRow(), error: null }];
    const d = await getTransactionDetail("t1");

    expect(h.state.queries).toHaveLength(1);
    expect(h.state.queries[0].table).toBe("transactions");
    expect(h.state.queries[0].filters).toEqual([["id", "t1"]]);

    expect(d).toMatchObject({
      id: "t1",
      receipt_no: "INV-1",
      status: "PAID",
      cashier_name: "Sari",
      original_receipt_no: null,
      returns: [],
      // angka/boolean null dinormalisasi
      points_earned: 0,
      points_redeemed: 0,
      customer_id: null,
    });
    expect(d.items).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({
      method: "TEMPO",
      due_date: "2026-12-01",
      is_settled: false, // null -> false
    });
  });

  it("tanpa data kasir / item / pembayaran: nilai aman, bukan crash", async () => {
    h.state.queryResults = [
      {
        data: baseRow({ cashier: null, transaction_items: null, payments: null }),
        error: null,
      },
    ];
    const d = await getTransactionDetail("t1");
    expect(d.cashier_name).toBeNull();
    expect(d.items).toEqual([]);
    expect(d.payments).toEqual([]);
  });

  it("baris retur: mengambil nomor struk penjualan asal", async () => {
    h.state.queryResults = [
      { data: baseRow({ status: "RETURN", related_transaction_id: "orig" }), error: null },
      { data: { receipt_no: "INV-ASAL" }, error: null },
    ];
    const d = await getTransactionDetail("ret1");
    expect(h.state.queries[1].filters).toEqual([["id", "orig"]]);
    expect(d.original_receipt_no).toBe("INV-ASAL");
    expect(d.returns).toEqual([]); // tidak mencari retur atas baris retur
    expect(h.state.queries).toHaveLength(2);
  });

  it("baris retur yang transaksi asalnya tidak ditemukan: original_receipt_no null", async () => {
    h.state.queryResults = [
      { data: baseRow({ related_transaction_id: "orig" }), error: null },
      { data: null, error: null },
    ];
    expect((await getTransactionDetail("ret1")).original_receipt_no).toBeNull();
  });

  it("penjualan berstatus RETURN: memuat daftar retur terurut lama -> baru", async () => {
    h.state.queryResults = [
      { data: baseRow({ status: "RETURN" }), error: null },
      {
        data: [
          {
            id: "r1",
            receipt_no: "RET-1",
            created_at: "2026-11-02T00:00:00Z",
            subtotal: "50000",
            void_reason: "rusak",
            cashier: { full_name: "Andi" },
            transaction_items: [
              { id: "ri1", product_name: "Kaos", unit: null, qty: "1", subtotal: "50000" },
            ],
            payments: [
              { method: "CASH", amount: "-50000", reference_no: null, notes: null },
            ],
          },
          {
            id: "r2",
            receipt_no: "RET-2",
            created_at: "2026-11-03T00:00:00Z",
            subtotal: null,
            void_reason: null,
            cashier: null,
            transaction_items: null,
            payments: null,
          },
        ],
        error: null,
      },
    ];

    const d = await getTransactionDetail("t1");

    const q = h.state.queries[1];
    expect(q.filters).toEqual([
      ["related_transaction_id", "t1"],
      ["status", "RETURN"],
    ]);
    expect(q.order).toEqual(["created_at", { ascending: true }]);

    expect(d.returns).toEqual([
      {
        id: "r1",
        receipt_no: "RET-1",
        created_at: "2026-11-02T00:00:00Z",
        cashier_name: "Andi",
        reason: "rusak",
        refund_amount: 50_000,
        items: [
          { id: "ri1", product_name: "Kaos", unit: null, qty: 1, subtotal: 50_000 },
        ],
        payments: [
          { method: "CASH", amount: -50_000, reference_no: null, notes: null },
        ],
      },
      {
        id: "r2",
        receipt_no: "RET-2",
        created_at: "2026-11-03T00:00:00Z",
        cashier_name: null,
        reason: null,
        refund_amount: 0,
        items: [],
        payments: [],
      },
    ]);
  });

  it("status RETURN tanpa retur tercatat: daftar kosong", async () => {
    h.state.queryResults = [
      { data: baseRow({ status: "RETURN" }), error: null },
      { data: null, error: null },
    ];
    expect((await getTransactionDetail("t1")).returns).toEqual([]);
  });

  it("error query utama", async () => {
    h.state.queryResults = [{ data: null, error: { message: "Row tidak ada" } }];
    await expect(getTransactionDetail("x")).rejects.toThrow("Row tidak ada");

    h.state.queryResults = [{ data: null, error: { message: "" } }];
    await expect(getTransactionDetail("x")).rejects.toThrow(
      "Gagal memuat detail transaksi.",
    );
  });

  it("error query riwayat retur dilempar keras, tidak diam-diam kosong", async () => {
    h.state.queryResults = [
      { data: baseRow({ status: "RETURN" }), error: null },
      { data: null, error: { message: "" } },
    ];
    await expect(getTransactionDetail("t1")).rejects.toThrow("Gagal memuat riwayat retur.");
  });
});
