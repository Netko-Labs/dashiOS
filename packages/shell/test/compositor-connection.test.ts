import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LockWatch } from "../src/agents/lock.ts";
import { Compositor } from "../src/compositor.ts";
import { fakeClock, until } from "./support/time.ts";

type Answer = (request: { id: number; method: string }) => unknown;

/** A fake dashi-comp on a socket of its own: `answer` says what each request gets (undefined: nothing). */
function fakeCompositor(answer: Answer): { path: string; hangUp(): void; stop(): void } {
  const dir = mkdtempSync(join(tmpdir(), "dashi-comp-test-"));
  const path = join(dir, "dashi-comp.sock");
  const clients = new Set<Bun.Socket<undefined>>();
  let buffered = "";
  const server = Bun.listen({
    unix: path,
    socket: {
      open: (socket) => void clients.add(socket),
      close: (socket) => void clients.delete(socket),
      data: (socket, data) => {
        buffered += data.toString();
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const request = JSON.parse(line) as { id: number; method: string };
          const result = request.method === "subscribe" ? {} : answer(request);
          if (result !== undefined) socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
        }
      },
    },
  });
  return {
    path,
    hangUp: () => {
      for (const client of clients) client.end();
    },
    stop: () => {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

async function connected(answer: Answer, timeoutMs = 5000): Promise<{ compositor: Compositor; fake: ReturnType<typeof fakeCompositor> }> {
  const fake = fakeCompositor(answer);
  stops.push(fake.stop);
  const compositor = await Compositor.connect({ path: fake.path, timeoutMs });
  if (!compositor) throw new Error("no connection to the fake");
  return { compositor, fake };
}

test("a request with no reply gives up after its time", async () => {
  const { compositor } = await connected(() => undefined, 50);
  const clock = fakeClock();
  stops.push(clock.restore);
  let windows: unknown = null;
  compositor.request("windows").catch((error) => {
    windows = error;
  });
  await clock.advance(50);
  expect(String(windows)).toContain("dashi-comp: no reply to windows");
  // Its own time, when it says one: not given up a moment before it.
  let outputs: unknown = null;
  compositor.request("outputs", {}, 120).catch((error) => {
    outputs = error;
  });
  await clock.advance(119);
  expect(outputs).toBeNull();
  await clock.advance(1);
  expect(String(outputs)).toContain("no reply to outputs");
});

test("when the compositor goes, what waits is rejected and what comes later is refused at once", async () => {
  const { compositor, fake } = await connected(() => undefined);
  let closed = 0;
  compositor.onClosed(() => closed++);
  const waiting = compositor.request("windows");
  fake.hangUp();
  await expect(waiting).rejects.toThrow("dashi-comp closed the connection");
  await expect(compositor.request("outputs")).rejects.toThrow("dashi-comp closed the connection");
  expect(closed).toBe(1);
});

test("a reply in time is not cut short by its timer", async () => {
  const { compositor } = await connected(() => ({ windows: [] }), 100);
  const clock = fakeClock();
  stops.push(clock.restore);
  expect(await compositor.windows()).toEqual([]);
  // Past the first request's time: its timer was cleared with the reply.
  await clock.advance(150);
  expect(await compositor.windows()).toEqual([]);
});

const session = { waylandDisplay: "wayland-1", display: null, xwayland: "off", pointer: { x: 1, y: 2 } };

test("the session says whether the screen is locked", async () => {
  const { compositor } = await connected(() => ({ ...session, locked: true }));
  expect(await compositor.session()).toEqual({ waylandDisplay: "wayland-1", display: null, xwayland: "off", pointer: { x: 1, y: 2 }, locked: true });
});

test("a session answer without the lock state is not understood", async () => {
  const { compositor } = await connected(() => session);
  expect(compositor.session()).rejects.toThrow("locked");
});

test("agents stay locked out until the compositor says the screen is unlocked", async () => {
  const unknown = await connected(() => session);
  const unsure = new LockWatch(unknown.compositor);
  expect(unsure.isLocked).toBe(true);
  // Replies come in order: once this one is in, the watch has had its answer.
  await unknown.compositor.session().catch(() => null);
  expect(unsure.isLocked).toBe(true);

  const open = await connected(() => ({ ...session, locked: false }));
  const watch = new LockWatch(open.compositor);
  await until(() => !watch.isLocked, "the watch to hear the screen is unlocked");
  expect(watch.isLocked).toBe(false);
});
