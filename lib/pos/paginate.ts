// lib/pos/paginate.ts
// ── TAMBAHAN (Laporan) ── Pembantu ambil semua baris per halaman.
// Supabase membatasi satu query sampai 1000 baris secara bawaan; tanpa
// paginasi, rentang ramai bisa terpotong diam-diam. Pemakai WAJIB menambah
// `.order(...)` yang stabil (mis. created_at lalu id) pada query-nya.

export const PAGE_SIZE = 1000;
export const ID_CHUNK_SIZE = 150;

export interface PageResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResponse>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}