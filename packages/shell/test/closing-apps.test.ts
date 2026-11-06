import { expect, test } from "bun:test";
import { type AppWindow, ClosingChoice, closeApps, HOLD_AFTER_MS, holdingCopy } from "../src/closing-apps.ts";

/** A clock that moves only when the code sleeps. */
function clock() {
  let at = 0;
  return { now: () => at, sleep: async (ms: number) => void (at += ms) };
}

function desktop(windows: AppWindow[]) {
  const open = new Map(windows.map((window) => [window.id, window]));
  const asked: number[] = [];
  return {
    open,
    asked,
    windows: async () => [...open.values()],
    close: async (id: number) => void asked.push(id),
  };
}

test("apps with nothing to lose close at once: no sheet, the session goes", async () => {
  const time = clock();
  const apps = desktop([
    { id: 1, name: "Files" },
    { id: 2, name: "Notes" },
  ]);
  const shown: string[][] = [];
  const outcome = await closeApps(
    {
      ...time,
      windows: apps.windows,
      close: async (id) => {
        await apps.close(id);
        apps.open.delete(id);
      },
      holding: (names) => void shown.push([...names]),
      done: () => {},
    },
    new ClosingChoice(),
  );
  expect(outcome).toBe("closed");
  expect(apps.asked).toEqual([1, 2]);
  expect(shown).toEqual([]);
});

test("an app that holds its window to ask is named after a moment, and its answer ends the wait", async () => {
  const time = clock();
  const apps = desktop([
    { id: 1, name: "Files" },
    { id: 7, name: "Text Editor" },
  ]);
  const shown: Array<[string[], number, number]> = [];
  let done = 0;
  const outcome = await closeApps(
    {
      ...time,
      windows: async () => {
        // The person answers Save a while after the sheet came up.
        if (time.now() >= HOLD_AFTER_MS + 600) apps.open.delete(7);
        return apps.windows();
      },
      close: async (id) => {
        await apps.close(id);
        if (id === 1) apps.open.delete(id);
      },
      holding: (names, first) => void shown.push([[...names], first, time.now()]),
      done: () => void done++,
    },
    new ClosingChoice(),
  );
  expect(outcome).toBe("closed");
  expect(shown.length).toBe(1);
  expect(shown[0]?.[0]).toEqual(["Text Editor"]);
  expect(shown[0]?.[1]).toBe(7);
  expect(shown[0]?.[2]).toBeGreaterThanOrEqual(HOLD_AFTER_MS);
  expect(done).toBe(1);
});

test("Cancel on the sheet keeps the session; going anyway ends the wait too", async () => {
  for (const answer of ["cancel", "anyway"] as const) {
    const time = clock();
    const apps = desktop([{ id: 3, name: "Terminal" }]);
    const choice = new ClosingChoice();
    const outcome = await closeApps({ ...time, windows: apps.windows, close: apps.close, holding: () => (choice.answer = answer), done: () => {} }, choice);
    expect(outcome).toBe(answer);
  }
});

test("a window that opens meanwhile doesn't hold the session", async () => {
  const time = clock();
  const apps = desktop([{ id: 1, name: "Files" }]);
  const outcome = await closeApps(
    {
      ...time,
      windows: apps.windows,
      close: async (id) => {
        apps.open.delete(id);
        apps.open.set(9, { id: 9, name: "Helium" });
      },
      holding: () => {},
      done: () => {},
    },
    new ClosingChoice(),
  );
  expect(outcome).toBe("closed");
});

test("the sheet's words name one app, two, or count them", () => {
  expect(holdingCopy(["Text Editor"], "logout")).toEqual({
    title: "Waiting for “Text Editor” to close",
    detail: "Dashi will log out once it closes. It may be asking about unsaved changes.",
    anyway: "Log out anyway",
  });
  expect(holdingCopy(["Text Editor", "Terminal"], "restart").title).toBe("Waiting for “Text Editor” and “Terminal” to close");
  expect(holdingCopy(["A", "B", "C"], "shutdown")).toMatchObject({ title: "Waiting for 3 apps to close", anyway: "Shut down anyway" });
});
