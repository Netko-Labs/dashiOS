import { expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { busyWait, type Clock, Hands, PersonBusy, QUIET_MS, readsOnePersonSeat, WAIT_MS } from "../src/agents/desktop/hands.ts";
import { handsCall } from "../src/agents/desktop/input.ts";
import { describePerson } from "../src/agents/desktop/lib/input-words.ts";
import type { CompositorEvent } from "../src/compositor/events.ts";
import { fakeCompositor } from "./support/compositor.ts";

/**
 * A fake dashi-comp that borrows the person's seat by its rule (session/idle.rs):
 * refused until the person's own last input is `idleMs` old. `press` is the
 * person's hands; nothing the agent sends counts as theirs.
 */
function desktop() {
  let now = 0;
  let personAt = Number.NEGATIVE_INFINITY;
  const listeners = new Set<(event: CompositorEvent) => void>();
  const sent: Array<Record<string, unknown>> = [];
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  const compositor = fakeCompositor(
    async (method, params) => {
      expect(method).toBe("agent-input");
      const borrow = params?.borrow as { idleMs: number } | undefined;
      const away = now - personAt;
      if (borrow && away < borrow.idleMs) throw new Error(`the person is using the desktop (free in ${borrow.idleMs - away} ms)`);
      sent.push(params ?? {});
      return {};
    },
    {
      on(listener: (event: CompositorEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  );
  return {
    clock,
    compositor,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
    /** The person presses something in `window` (or on the desktop): the compositor's `person-input`. */
    press: (window: number | null) => {
      personAt = now;
      for (const listener of listeners) listener({ event: "person-input", window });
    },
  };
}

const HELIUM = { id: 2, appId: "helium" };
const EDITOR = { id: 3, appId: "org.gnome.TextEditor" };
const click = { pointer: { x: 10, y: 10 }, action: "click" } as const;

test("unattended, an agent's clicks and keys into a borrowing app go through every time", async () => {
  const vm = desktop();
  const hands = new Hands(vm.compositor, vm.clock);
  const said: string[] = [];
  for (let n = 0; n < 50; n++) {
    await hands.send(HELIUM, n % 2 ? click : { keys: [{ text: "a" }] }, "Claude", (words) => said.push(words));
    vm.advance(30);
  }
  expect(vm.sent).toHaveLength(50);
  expect(said).toEqual([]);
});

test("the person wins at once: the agent's next action waits for their pause", async () => {
  const vm = desktop();
  const hands = new Hands(vm.compositor, vm.clock);
  const said: string[] = [];
  vm.advance(10_000);
  vm.press(HELIUM.id);
  const start = vm.clock.now();
  await hands.send(HELIUM, click, "Claude", (words) => said.push(words));
  // Let in QUIET_MS after the person's last input (within a poll), having said it waited.
  expect(vm.clock.now() - start).toBeGreaterThanOrEqual(QUIET_MS);
  expect(vm.clock.now() - start).toBeLessThan(QUIET_MS + 500);
  expect(said[0]).toBe("Waiting for you to pause");
  expect(vm.sent).toHaveLength(1);
});

test("a person who keeps working holds the desktop; the refusal says how long to wait", async () => {
  const vm = desktop();
  const hands = new Hands(vm.compositor, vm.clock);
  vm.advance(10_000);
  // The person types on, a key every 200 ms, while the agent waits.
  const typing = {
    ...vm.clock,
    sleep: async (ms: number) => {
      for (let t = 0; t < ms; t += 50) {
        vm.advance(50);
        if (vm.clock.now() % 200 === 0) vm.press(null);
      }
    },
  };
  const busy = new Hands(vm.compositor, typing);
  vm.press(null);
  const error = await busy.send(HELIUM, click, "Claude", () => {}).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(PersonBusy);
  const refusal = error as PersonBusy;
  expect(refusal.desktop).toBe(true);
  expect(refusal.waitMs).toBeGreaterThan(0);
  expect(refusal.waitMs).toBeLessThanOrEqual(QUIET_MS);
  expect(vm.sent).toHaveLength(0);
  const words = describePerson(refusal).content[0];
  expect(words?.type === "text" && words.text).toContain(`didn't pause within ${WAIT_MS / 1000} s`);
  expect(words?.type === "text" && words.text).toContain(`left it alone for ${QUIET_MS / 1000} s`);
  // They stop: QUIET_MS later the agent is back in.
  vm.advance(QUIET_MS);
  await hands.send(HELIUM, click, "Claude", () => {});
  expect(vm.sent).toHaveLength(1);
});

test("on the agent's own seat, the person's window is theirs for QUIET_MS after their last press", async () => {
  const vm = desktop();
  const hands = new Hands(vm.compositor, vm.clock);
  vm.advance(10_000);
  vm.press(EDITOR.id);
  vm.advance(500);
  const error = (await hands.send(EDITOR, click, "Claude", () => {}).catch((caught: unknown) => caught)) as PersonBusy;
  expect(error).toBeInstanceOf(PersonBusy);
  expect(error.desktop).toBe(false);
  expect(error.waitMs).toBe(QUIET_MS - 500);
  const words = describePerson(error).content[0];
  expect(words?.type === "text" && words.text).toContain("Wait at least 2 s and try again, or work in another window.");
  // Another window is free meanwhile, and the agent's own input never makes the person look busy.
  await hands.send({ id: 4, appId: "org.gnome.Calculator" }, click, "Claude", () => {});
  await hands.send({ id: 4, appId: "org.gnome.Calculator" }, click, "Claude", () => {});
  expect(hands.busyFor(4)).toBe(0);
  vm.advance(QUIET_MS - 500);
  await hands.send(EDITOR, click, "Claude", () => {});
  expect(vm.sent).toHaveLength(3);
});

test("the compositor's refusal names the wait; an older one without it means a whole QUIET_MS", () => {
  expect(busyWait("the person is using the desktop (free in 1200 ms)")).toBe(1200);
  expect(busyWait("the person is using the desktop")).toBe(QUIET_MS);
  expect(busyWait("the person is using the desktop (free in 99999 ms)")).toBe(QUIET_MS);
});

// Files, a Metal window: it hears only the person's seat, so every step of a drag borrows it.
const FILES = { id: 5, appId: "dev.dashi.files", title: "Home", state: "normal", frame: { x: 0, y: 0, width: 400, height: 300 }, titleBar: 0 };

/** What `drag` needs of a run: the window, the hands, and nothing said. */
const run = (hands: Hands): RunContext =>
  ({ compositor: { windows: async () => [FILES] }, hands, agent: "Claude", status: () => {}, mayName: () => false }) as unknown as RunContext;

const dragCall = { name: "drag", window: FILES.id, from: { x: 10, y: 10 }, to: { x: 90, y: 50 } } as const;

test("an agent drags in a Metal window: press, moves and release on the person's seat, borrowed", async () => {
  expect(readsOnePersonSeat(FILES.appId)).toBe(true);
  const vm = desktop();
  vm.advance(10_000);
  const result = await handsCall(dragCall, run(new Hands(vm.compositor, vm.clock)));
  expect(result.isError).toBeUndefined();
  expect(result.content[0]).toEqual({ type: "text", text: "Dragged in w5 from (10, 10) to (90, 50)." });
  expect(vm.sent.map((sent) => sent.action)).toEqual(["press", "move", "move", "move", "move", "move", "move", "move", "release"]);
  expect(vm.sent.every((sent) => (sent.borrow as { idleMs: number }).idleMs === QUIET_MS)).toBe(true);
  expect(vm.sent[0]?.pointer).toEqual({ x: 10, y: 10 });
  expect(vm.sent.at(-1)?.pointer).toEqual({ x: 90, y: 50 });
});

test("the person coming back mid-drag ends it at once: the button is let go, and the result says where", async () => {
  const vm = desktop();
  vm.advance(10_000);
  let gaps = 0;
  // The person presses a key during the third gap between steps.
  const clock: Clock = {
    now: vm.clock.now,
    sleep: async (ms) => {
      await vm.clock.sleep(ms);
      if (++gaps === 3) vm.press(null);
    },
  };
  const start = vm.clock.now();
  const result = await handsCall(dragCall, run(new Hands(vm.compositor, clock)));
  expect(result.isError).toBe(true);
  const words = result.content[0];
  expect(words?.type === "text" && words.text).toContain("The person started using the desktop midway, so the drag was let go at (30, 20)");
  // Two moves got through; the third was refused and not waited out; then everything is let go.
  expect(vm.sent.map((sent) => sent.action ?? (sent.release ? "let go" : null))).toEqual(["press", "move", "move", "let go"]);
  expect(vm.clock.now() - start).toBeLessThan(WAIT_MS / 10);
});

test("the person coming back mid-scroll: what was scrolled stays, and the result says how far it got", async () => {
  const vm = desktop();
  vm.advance(10_000);
  let gaps = 0;
  // The person comes back in the gap after the second of five flicks, and keeps at it past the wait.
  const clock: Clock = {
    now: vm.clock.now,
    sleep: async (ms) => {
      await vm.clock.sleep(ms);
      if (++gaps >= 2) vm.press(null);
    },
  };
  const call = { name: "scroll", window: FILES.id, x: 40, y: 40, dx: 0, dy: 600 } as const;
  const result = await handsCall(call, run(new Hands(vm.compositor, clock)));
  expect(vm.sent.map((sent) => sent.scroll)).toEqual([
    { dx: 0, dy: 120 },
    { dx: 0, dy: 120 },
  ]);
  expect(result.isError).toBe(true);
  const words = result.content[0];
  expect(words?.type === "text" && words.text).toContain("so the scroll stopped after (0, 240) of (0, 600)");
});
