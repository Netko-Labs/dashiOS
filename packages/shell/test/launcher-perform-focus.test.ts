// Choosing a window's row (launcher/lib/perform.ts): the launcher closes, with or without something to focus through.
import { expect, test } from "bun:test";
import { type PerformDeps, perform } from "../src/launcher/lib/perform.ts";

type Effect = Parameters<typeof perform>[0];
/** Choosing a window's row. */
const FOCUS = { kind: "focus", window: { id: 7 } } as unknown as Effect;

function deps(host: { focus(window: { id: number }): Promise<void> } | undefined) {
  const heard: string[] = [];
  const d = {
    props: host ? { host } : {},
    search: { finish: (stay: boolean) => void heard.push(`finish ${stay}`) },
    learn: () => void heard.push("learn"),
  } as unknown as PerformDeps;
  return { heard, d };
}

test("with no host to focus through, a window row still closes the launcher", () => {
  const { heard, d } = deps(undefined);
  perform(FOCUS, undefined, false, d);
  expect(heard).toEqual(["learn", "finish false"]);
});

test("with a host, the window is focused first, then the launcher closes", async () => {
  const focused: number[] = [];
  const { heard, d } = deps({ focus: async (window) => void focused.push(window.id) });
  perform(FOCUS, undefined, true, d);
  await Promise.resolve();
  await Promise.resolve();
  expect(focused).toEqual([7]);
  expect(heard).toEqual(["learn", "finish true"]);
});
