import { expect, test } from "bun:test";
import { endMachine, GRACE_MS, runClosers } from "../src/shutdown.ts";

/** A clock that moves only when the code sleeps. */
function clock() {
  let at = 0;
  return { now: () => at, sleep: async (ms: number) => void (at += ms) };
}

test("apps that close in time: the machine goes as soon as they are gone", async () => {
  const time = clock();
  const alive = new Set([101, 102]);
  const signals: string[] = [];
  let asked: string | null = null;
  let askedAt = -1;
  const left = await endMachine("restart", {
    ...time,
    processes: async () => [
      { pid: 101, name: "Helium" },
      { pid: 102, name: "Files" },
    ],
    signal: (pid, signal) => {
      signals.push(`${pid} ${signal}`);
      alive.delete(pid);
    },
    isAlive: (pid) => alive.has(pid),
    machine: async (what) => {
      asked = what;
      askedAt = time.now();
    },
  });
  expect(left).toEqual([]);
  expect(signals).toEqual(["101 SIGTERM", "102 SIGTERM"]);
  expect(asked === "restart").toBe(true);
  expect(askedAt).toBe(0);
});

test("an app stuck in the driver: 10 s, a word about it, a kill, and logind is asked anyway", async () => {
  const time = clock();
  const signals: string[] = [];
  const waited: Array<[readonly string[], number]> = [];
  let askedAt = -1;
  const left = await endMachine("shutdown", {
    ...time,
    processes: async () => [
      { pid: 5964, name: "Steam" },
      { pid: 5965, name: "Steam" },
    ],
    signal: (pid, signal) => void signals.push(`${pid} ${signal}`),
    // Uninterruptible: neither signal ends it.
    isAlive: () => true,
    waiting: (names, seconds) => void waited.push([names, seconds]),
    machine: async () => {
      askedAt = time.now();
    },
  });
  expect(left).toEqual(["Steam"]);
  expect(waited).toEqual([[["Steam"], 7]]);
  expect(signals.filter((signal) => signal.endsWith("SIGKILL"))).toEqual(["5964 SIGKILL", "5965 SIGKILL"]);
  expect(askedAt).toBe(GRACE_MS);
});

test("no apps, or no answer about them: straight to logind", async () => {
  let asked = 0;
  await endMachine("restart", {
    processes: async () => Promise.reject(new Error("no compositor")),
    signal: () => {},
    isAlive: () => true,
    machine: async () => void asked++,
  });
  expect(asked).toBe(1);
});

test("closers: one that throws doesn't stop the rest", () => {
  const ran: string[] = [];
  const failed = runClosers(
    [
      ["a", () => ran.push("a")],
      [
        "b",
        () => {
          throw new Error("b");
        },
      ],
      ["c", () => ran.push("c")],
    ],
    () => {},
  );
  expect(ran).toEqual(["a", "c"]);
  expect(failed).toEqual(["b"]);
});
