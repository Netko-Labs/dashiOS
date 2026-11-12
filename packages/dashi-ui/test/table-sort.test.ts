import { describe, expect, test } from "bun:test";
import { holdOrder } from "../src/table-sort.ts";

describe("holding a table's order", () => {
  const key = (row: { pid: number }): number => row.pid;
  const rows = (...pids: number[]) => pids.map((pid) => ({ pid }));

  test("rows keep the places they were drawn in, whatever the new sort says", () => {
    expect(holdOrder([1, 2, 3], rows(3, 1, 2), key).map(key)).toEqual([1, 2, 3]);
  });
  test("a row that is gone drops out, and a new one goes after the row it follows in the new order", () => {
    expect(holdOrder([1, 2, 3], rows(4, 3, 1, 5), key).map(key)).toEqual([4, 1, 5, 3]);
    expect(holdOrder([], rows(2, 1), key).map(key)).toEqual([2, 1]);
  });

  test("an app expanded while the order is held shows its processes under it, not at the end", () => {
    // Apps 10, 20, 30 held as drawn (30 first); 20 expands into 21 and 22, and the sort now says 10, 20, 21, 22, 30.
    expect(holdOrder([30, 10, 20], rows(10, 20, 21, 22, 30), key).map(key)).toEqual([30, 10, 20, 21, 22]);
    expect(holdOrder([30, 20, 10], rows(10, 20, 21, 22, 30), key).map(key)).toEqual([30, 20, 21, 22, 10]);
  });
});
