import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRANCH_BASE_COLUMNS, BRANCH_COLUMNS, BRANCH_COLUMNS_NO_TYPE } from "../branches";
import { selectBranchRows } from "../branchQuery";

type Reply = { data: unknown; error: { message: string } | null };

function fakeClient(replies: Record<string, Reply>) {
  const asked: string[] = [];
  const client = {
    from: () => ({
      select: (columns: string) => {
        asked.push(columns);
        const reply = replies[columns] ?? { data: null, error: { message: "tidak terduga" } };
        const chain = {
          order: () => chain,
          then: (resolve: (r: Reply) => unknown) => resolve(reply),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, asked };
}

describe("selectBranchRows", () => {
  it("memakai kolom lengkap kalau database sudah termigrasi", async () => {
    const { client, asked } = fakeClient({ [BRANCH_COLUMNS]: { data: [{ id: "a" }], error: null } });
    const res = await selectBranchRows(client);
    expect(res.rows).toEqual([{ id: "a" }]);
    expect(res.errorMessage).toBeNull();
    expect(asked).toEqual([BRANCH_COLUMNS]);
  });

  it("jatuh ke kolom tanpa branch_type kalau migration 053 belum jalan", async () => {
    const { client, asked } = fakeClient({
      [BRANCH_COLUMNS]: { data: null, error: { message: "column branches.branch_type does not exist" } },
      [BRANCH_COLUMNS_NO_TYPE]: { data: [{ id: "a" }], error: null },
    });
    const res = await selectBranchRows(client);
    expect(res.rows).toEqual([{ id: "a" }]);
    expect(asked).toEqual([BRANCH_COLUMNS, BRANCH_COLUMNS_NO_TYPE]);
  });

  it("jatuh ke kolom dasar kalau migration 048 juga belum jalan", async () => {
    const { client, asked } = fakeClient({
      [BRANCH_COLUMNS]: { data: null, error: { message: "column branches.timezone does not exist" } },
      [BRANCH_COLUMNS_NO_TYPE]: { data: null, error: { message: "column branches.timezone does not exist" } },
      [BRANCH_BASE_COLUMNS]: { data: [{ id: "a" }], error: null },
    });
    const res = await selectBranchRows(client);
    expect(res.rows).toEqual([{ id: "a" }]);
    expect(asked).toEqual([BRANCH_COLUMNS, BRANCH_COLUMNS_NO_TYPE, BRANCH_BASE_COLUMNS]);
  });

  it("error lain tidak diulang dan dikembalikan apa adanya", async () => {
    const { client, asked } = fakeClient({
      [BRANCH_COLUMNS]: { data: null, error: { message: "permission denied" } },
    });
    const res = await selectBranchRows(client);
    expect(res.rows).toEqual([]);
    expect(res.errorMessage).toBe("permission denied");
    expect(asked).toEqual([BRANCH_COLUMNS]);
  });
});
