import { describe, expect, it } from "vitest";
import { filterCategoriesForBranch, isMissingCategoryBranchError } from "../categoryBranch";

describe("filterCategoriesForBranch", () => {
  const categories = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("hanya mengembalikan kategori yang terpasang di outlet", () => {
    expect(filterCategoriesForBranch(categories, new Set(["a", "c"])).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("kategori yang belum dipasang tidak muncul", () => {
    expect(filterCategoriesForBranch(categories, new Set())).toEqual([]);
  });
});

describe("isMissingCategoryBranchError", () => {
  it("mengenali tabel/fungsi yang belum ada", () => {
    expect(isMissingCategoryBranchError({ code: "42P01" })).toBe(true);
    expect(isMissingCategoryBranchError({ code: "PGRST205" })).toBe(true);
    expect(isMissingCategoryBranchError({ message: "relation e_pos.category_branches does not exist" })).toBe(true);
  });

  it("error lain bukan migration yang hilang", () => {
    expect(isMissingCategoryBranchError({ message: "permission denied" })).toBe(false);
    expect(isMissingCategoryBranchError(null)).toBe(false);
  });
});
