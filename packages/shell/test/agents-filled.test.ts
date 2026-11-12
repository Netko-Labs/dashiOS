import { expect, test } from "bun:test";
import { dropExpired } from "../src/agents/lib/server-shared.ts";

test("a filled field whose time is up is forgotten, and its window with it", () => {
  const filled = new Map([
    [1, [{ until: 100 }, { until: 300 }]],
    [2, [{ until: 100 }]],
    [3, [{ until: 300 }]],
  ]);
  dropExpired(filled, 200);
  expect([...filled]).toEqual([
    [1, [{ until: 300 }]],
    [3, [{ until: 300 }]],
  ]);
});
