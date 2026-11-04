import { describe, expect, it, vi } from "vitest";
import { chunkArray, fetchAllPages, ID_CHUNK_SIZE, PAGE_SIZE } from "../paginate";

const rows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: offset + i }));

describe("fetchAllPages", () => {
  it("satu halaman yang tidak penuh: berhenti setelah 1 panggilan", async () => {
    const build = vi.fn(async () => ({ data: rows(10), error: null }));
    const result = await fetchAllPages<{ id: number }>(build);
    expect(result).toHaveLength(10);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(0, PAGE_SIZE - 1);
  });

  it("beberapa halaman: rentang from/to berurutan dan hasil digabung", async () => {
    const pages = [rows(PAGE_SIZE, 0), rows(PAGE_SIZE, PAGE_SIZE), rows(5, PAGE_SIZE * 2)];
    const build = vi.fn(async (from: number) => ({
      data: pages[from / PAGE_SIZE],
      error: null,
    }));
    const result = await fetchAllPages<{ id: number }>(build);

    expect(result).toHaveLength(PAGE_SIZE * 2 + 5);
    expect(result[0].id).toBe(0);
    expect(result[result.length - 1].id).toBe(PAGE_SIZE * 2 + 4);
    expect(build.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("jumlah baris pas kelipatan halaman: butuh 1 panggilan ekstra (kosong) untuk berhenti", async () => {
    const build = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(PAGE_SIZE) : [],
      error: null,
    }));
    const result = await fetchAllPages(build);
    expect(result).toHaveLength(PAGE_SIZE);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("data null dianggap kosong", async () => {
    const result = await fetchAllPages(async () => ({ data: null, error: null }));
    expect(result).toEqual([]);
  });

  it("error di halaman mana pun dilempar dan menghentikan proses", async () => {
    const build = vi.fn(async (from: number) =>
      from === 0
        ? { data: rows(PAGE_SIZE), error: null }
        : { data: null, error: { message: "timeout" } },
    );
    await expect(fetchAllPages(build)).rejects.toThrow("timeout");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("menerima PromiseLike (bukan hanya Promise)", async () => {
    const thenable = { then: (res: (v: unknown) => void) => res({ data: rows(2), error: null }) };
    const result = await fetchAllPages(() => thenable as never);
    expect(result).toHaveLength(2);
  });
});

describe("chunkArray", () => {
  it("memecah sesuai ukuran, sisa di potongan terakhir", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("kelipatan pas tidak menyisakan potongan kosong", () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("array kosong -> []", () => {
    expect(chunkArray([], 3)).toEqual([]);
  });

  it("ukuran lebih besar dari panjang -> satu potongan", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("tidak mengubah array asli", () => {
    const src = [1, 2, 3];
    chunkArray(src, 2);
    expect(src).toEqual([1, 2, 3]);
  });

  it("batas ID_CHUNK_SIZE menjaga URL query tidak terlalu panjang", () => {
    const ids = Array.from({ length: ID_CHUNK_SIZE * 2 + 1 }, (_, i) => `id-${i}`);
    const chunks = chunkArray(ids, ID_CHUNK_SIZE);
    expect(chunks.map((c) => c.length)).toEqual([ID_CHUNK_SIZE, ID_CHUNK_SIZE, 1]);
  });
});
