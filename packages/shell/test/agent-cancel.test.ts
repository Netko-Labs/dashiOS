import { describe, expect, test } from "bun:test";
import { cancelledRequest, parse } from "../src/agents/mcp.ts";
import type { Answer, Ask, Turn } from "../src/agents/presence.ts";
import { Session, type SessionContext } from "../src/agents/session.ts";
import { DENY, type QueuedSheet, SheetQueue } from "../src/agents/sheet-queue.ts";
import { opaque } from "../src/consent.tsx";

const WINDOW = {
  id: 3,
  appId: "helium",
  title: "t",
  pid: 10,
  focused: true,
  state: "normal",
  frame: { x: 0, y: 0, width: 9, height: 9 },
  titleBar: 0,
};

/** A session whose sheets the test holds: `asks` and `turns` see each one and its signal. */
function harness(granted: string[]) {
  const sent: Array<Record<string, unknown>> = [];
  const asks: Array<{ ask: Ask; signal: AbortSignal | undefined; resolve(a: Answer): void }> = [];
  const turns: Array<{ turn: Turn; signal: AbortSignal | undefined }> = [];
  const ui = {
    ask: (ask: Ask, signal?: AbortSignal) =>
      new Promise<Answer>((resolve) => {
        asks.push({ ask, signal, resolve });
        signal?.addEventListener("abort", () => resolve(DENY));
      }),
    confirm: async () => false,
    signIn: async () => ({ allow: "deny" as const, login: null }),
    turn: (turn: Turn, signal?: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        turns.push({ turn, signal });
        signal?.addEventListener("abort", () => resolve(false));
      }),
    dismiss: () => {},
    stopped: () => {},
    whenNoSheet: async () => {},
  };
  const ctx = {
    compositor: { windows: async () => [WINDOW], request: async () => ({}) },
    ui,
    grants: { get: () => new Set(granted), set: () => {} },
    lock: { isLocked: false },
    publish: () => {},
    secrets: {
      sources: () => [],
      atspi: async () => null,
      handedOver: new Set<number>(),
      filled: new Map(),
      vault: { cards: async () => [], pay: async () => Promise.reject(new Error("no")) },
    },
  } as unknown as SessionContext;
  const session = new Session(
    1,
    { name: "claude", detail: "claude", key: "claude", remote: false },
    {
      write: (data) => {
        sent.push(JSON.parse(new TextDecoder().decode(data).trim()));
        return data.byteLength;
      },
      terminate: () => {},
    },
    ctx,
    () => {},
    true,
  );
  const say = (message: unknown) => session.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  say({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "test" } } });
  return { session, say, sent, asks, turns };
}

const callTool = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const cancel = (id: number) => ({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "timed out" } });

describe("a call the agent gives up on", () => {
  test("the cancellation is read from MCP", () => {
    expect(cancelledRequest(parse(JSON.stringify(cancel(7))))).toBe(7);
    expect(cancelledRequest(parse('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{}}'))).toBeNull();
    expect(cancelledRequest(parse('{"jsonrpc":"2.0","method":"notifications/initialized"}'))).toBeNull();
  });

  test("its 'Your turn' comes down, nothing is answered, and the agent's next calls aren't held", async () => {
    const h = harness(["act", "see"]);
    h.say(callTool(2, "hand_over", { window: "w3", reason: "Sign in to the bank" }));
    await Bun.sleep(5);
    expect(h.turns.length).toBe(1);
    h.say(cancel(2));
    await Bun.sleep(5);
    expect(h.turns[0]?.signal?.aborted).toBe(true);
    expect(h.sent.some((m) => m.id === 2)).toBe(false);
    h.say(callTool(3, "list_windows", {}));
    await Bun.sleep(20);
    expect(h.sent.some((m) => m.id === 3)).toBe(true);
  });

  test("its scope sheet comes down when no waiting call needs it, and that is no refusal", async () => {
    const h = harness([]);
    h.say(callTool(2, "list_windows", {}));
    await Bun.sleep(5);
    expect(h.asks.length).toBe(1);
    h.say(cancel(2));
    await Bun.sleep(5);
    expect(h.asks[0]?.signal?.aborted).toBe(true);
    // Asked again next time, not refused for good.
    h.say(callTool(3, "list_windows", {}));
    await Bun.sleep(5);
    expect(h.asks.length).toBe(2);
    expect(h.sent.some((m) => m.id === 2)).toBe(false);
  });
});

describe("sheets", () => {
  test("one whose caller gave up comes down, and the next comes up", () => {
    const shown: number[] = [];
    const answers: string[] = [];
    const queue = new SheetQueue<QueuedSheet>({
      open: (entry) => {
        shown.push(entry.agent);
        return { close: () => {} };
      },
      later: () => () => {},
    });
    const one = { agent: 1, resolve: (a: Answer) => void answers.push(`1:${a.allow}`) };
    const two = { agent: 2, resolve: (a: Answer) => void answers.push(`2:${a.allow}`) };
    queue.enqueue(one);
    queue.enqueue(two);
    queue.cancel(one);
    expect(answers).toEqual(["1:deny"]);
    expect(shown).toEqual([1, 2]);
  });

  test("their cards are solid, whatever glass the palette gives", () => {
    expect(opaque("#f5f5f7eb")).toBe("#f5f5f7");
    expect(opaque("#1e1e1e")).toBe("#1e1e1e");
  });
});
