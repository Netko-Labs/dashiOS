import { expect, test } from "bun:test";
import { type AppWindow, ClosingChoice, closeApps, HOLD_AFTER_MS, HOLDING_LINE, holdingCopy } from "../src/closing-apps.ts";

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

test("two apps that ask are asked one at a time: the next only once the first has gone", async () => {
  const time = clock();
  const apps = desktop([
    { id: 7, name: "Text Editor" },
    { id: 3, name: "Terminal" },
  ]);
  const shown: Array<[string[], number]> = [];
  let answeredAt = 0;
  const outcome = await closeApps(
    {
      ...time,
      windows: async () => {
        // The person answers the Editor's question after a while, then Terminal's.
        if (time.now() >= HOLD_AFTER_MS + 500 && apps.open.has(7)) {
          apps.open.delete(7);
          answeredAt = time.now();
        }
        if (answeredAt > 0 && time.now() >= answeredAt + 400) apps.open.delete(3);
        return apps.windows();
      },
      close: apps.close,
      holding: (names, first) => void shown.push([[...names], first]),
      done: () => {},
    },
    new ClosingChoice(),
  );
  expect(outcome).toBe("closed");
  // Terminal was asked only after the Editor had gone.
  expect(apps.asked).toEqual([7, 3]);
  // The notice brings forward the one asking, and names it first.
  expect(shown[0]).toEqual([["Text Editor", "Terminal"], 7]);
  expect(shown.at(-1)).toEqual([["Terminal"], 3]);
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

test("the notice's words name one app, two, or count them, and fit an unsaved document or a running job", () => {
  expect(holdingCopy(["Text Editor"], "logout")).toEqual({ line: "Waiting for “Text Editor”. It may be asking first.", anyway: "Log out anyway" });
  expect(holdingCopy(["Terminal"], "logout").line).not.toContain("unsaved");
  expect(holdingCopy(["Files", "Notes"], "restart")).toEqual({ line: "Waiting for “Files” and “Notes” to close.", anyway: "Restart anyway" });
  expect(holdingCopy(["A", "B", "C"], "shutdown")).toEqual({ line: "Waiting for 3 apps. They may be asking first.", anyway: "Shut down anyway" });
});

test("the notice is always one line: a long name drops the asking, two that don't fit are counted, one is cut", () => {
  expect(holdingCopy(["Activity Monitor"], "logout").line).toBe("Waiting for “Activity Monitor” to close.");
  expect(holdingCopy(["Text Editor", "Terminal"], "restart").line).toBe("Waiting for “Text Editor” and “Terminal” to close.");
  expect(holdingCopy(["Text Editor", "Activity Monitor"], "logout").line).toBe("Waiting for 2 apps. They may be asking first.");
  const long = holdingCopy(["A Very Long Application Name That Goes On"], "shutdown").line;
  expect(long).toStartWith("Waiting for “A Very Long");
  expect(long).toEndWith("…” to close.");
  for (const names of [["X"], ["Text Editor"], ["a".repeat(80)], ["b".repeat(40), "c"], ["1", "2", "3"], Array.from({ length: 120 }, String)]) {
    expect(holdingCopy(names, "shutdown").line.length).toBeLessThanOrEqual(HOLDING_LINE);
  }
});

test("Cancel tells the app that was asking: its question goes; Log out anyway tells nobody", async () => {
  for (const answer of ["cancel", "anyway"] as const) {
    const time = clock();
    const apps = desktop([
      { id: 3, name: "Terminal" },
      { id: 7, name: "Text Editor" },
    ]);
    const choice = new ClosingChoice();
    const withdrawn: number[] = [];
    const outcome = await closeApps(
      {
        ...time,
        windows: async () => {
          // Terminal asks "Quit Terminal?"; the person answers the notice instead.
          if (time.now() >= HOLD_AFTER_MS + 200) choice.answer ??= answer;
          return apps.windows();
        },
        close: apps.close,
        holding: () => {},
        done: () => {},
        withdraw: (window) => void withdrawn.push(window),
      },
      choice,
    );
    expect(outcome).toBe(answer);
    // Only Terminal was asked (one at a time), so only its question goes.
    expect(apps.asked).toEqual([3]);
    expect(withdrawn).toEqual(answer === "cancel" ? [3] : []);
  }
});
