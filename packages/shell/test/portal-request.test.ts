import { expect, test } from "bun:test";
import { type Exporter, Requests } from "../apps/portal/lib/request.ts";

test("a handle the bus wouldn't export is not left open: it can be asked for again", async () => {
  let refuse = true;
  const bus: Exporter = {
    export: (path) => {
      if (refuse) throw new Error("the bus is gone");
      return { path, emit: () => {}, propertiesChanged: () => {}, unexport: () => {} };
    },
  };
  const requests = new Requests(bus);
  await expect(requests.run("/r/1", async () => 1)).rejects.toThrow("the bus is gone");
  expect(requests.count).toBe(0);
  refuse = false;
  expect(await requests.run("/r/1", async () => 2)).toBe(2);
  expect(requests.count).toBe(0);
});
