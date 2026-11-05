import { describe, expect, test } from "bun:test";
import { focusedField, hasState, passwordFields, ROLE, STATE } from "../src/agents/atspi/tree.ts";
import { AGENT_MASK, AgentMask, FIELD_PAD, maskRequest, SHEET_LAYERS } from "../src/agents/mask.ts";
import { answeredByPerson, PERSON_PRESS_MS, personAnswered } from "../src/agents/person.ts";
import type { CompositorWindow } from "../src/compositor.ts";
import { bits, browser, tree } from "./fixtures/a11y-tree.ts";

function window(id: number, pid: number | null, appId = "firefox"): CompositorWindow {
  return {
    id,
    appId,
    title: `w${id}`,
    pid,
    focused: false,
    state: "normal",
    zoomed: false,
    frame: { x: 0, y: 0, width: 800, height: 600 },
    titleBar: 30,
  } as CompositorWindow;
}

describe("the accessibility walk", () => {
  test("state bits are read from both words", () => {
    expect(hasState(bits([STATE.SHOWING]), STATE.SHOWING)).toBe(true);
    expect(hasState(bits([STATE.SHOWING]), STATE.FOCUSED)).toBe(false);
    expect(hasState(bits([33]), 33)).toBe(true);
  });

  test("it finds the password fields that show, and not those on hidden tabs", async () => {
    const { rects, complete } = await passwordFields(browser("https://github.com/login"));
    expect(complete).toBe(true);
    expect(rects).toEqual([{ x: 100, y: 240, width: 240, height: 28 }]);
  });

  test("the focused field comes with the addresses of the documents around it, innermost first", async () => {
    expect(await focusedField(browser("https://github.com/login"))).toMatchObject({ kind: "password", documents: ["https://github.com/login"] });
    expect(await focusedField(browser("https://github.com/login", { focus: "user" }))).toMatchObject({ kind: "text" });
    const framed = await focusedField(browser("https://evil.example/", { frameUrl: "https://github.com/login" }));
    expect(framed?.documents).toEqual(["https://github.com/login", "https://evil.example/"]);
    expect(await focusedField(browser("https://github.com/login", { focus: null }))).toBeNull();
  });

  test("a walk gives up at its limits instead of holding a picture", async () => {
    const wide = tree({ role: ROLE.APPLICATION, children: Array.from({ length: 50 }, () => ({ role: ROLE.FRAME, states: [STATE.SHOWING] })) });
    const { complete } = await passwordFields(wide, { nodes: 10, deadline: Date.now() + 1000 });
    expect(complete).toBe(false);
  });
});

describe("what agents' pictures blank", () => {
  test("the request covers sheets, the vault, handed-over windows, and padded password fields", () => {
    const request = maskRequest({ handedOver: [4], vault: [7, 4], fields: [{ window: 3, rect: { x: 100, y: 240, width: 240, height: 28 } }], pids: [999] });
    expect(request).toEqual({
      client: AGENT_MASK,
      windows: [4, 7],
      rects: [{ window: 3, x: 100 - FIELD_PAD, y: 240 - FIELD_PAD, width: 240 + 2 * FIELD_PAD, height: 28 + 2 * FIELD_PAD }],
      layers: [...SHEET_LAYERS],
      pids: [999],
    });
    expect(SHEET_LAYERS).toContain("dashi.agent-consent");
  });

  test("an update finds password fields in each window's app and tells the compositor", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const mask = new AgentMask({
      request: async (method, params) => {
        expect(method).toBe("capture-mask");
        sent.push(params);
        return {};
      },
      windows: async () => [window(3, 100), window(5, 200, "dev.dashi.settings"), { ...window(6, 100), state: "minimized" }],
      atspi: async () => ({ appFor: async (pid: number) => (pid === 100 ? browser("https://github.com/login") : null) }),
      handedOver: () => [9],
      isVault: (w) => w.appId === "dev.dashi.settings",
    });
    mask.recording(4242);
    await mask.update();
    expect(sent[0]?.windows).toEqual([9, 5]);
    expect(sent[0]?.rects).toEqual([{ window: 3, x: 92, y: 232, width: 256, height: 44 }]);
    expect(sent[0]?.pids).toEqual([4242]);
    mask.recording(null);
    await mask.update();
    expect(sent[1]?.pids).toEqual([]);
  });

  test("without AT-SPI the sheets and windows are still blanked; a compositor that refuses means no picture", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const deps = {
      windows: async () => [window(3, 100)],
      atspi: async () => null,
      handedOver: () => [3],
      isVault: () => false,
    };
    await new AgentMask({ ...deps, request: async (_m, p) => sent.push(p) }).update();
    expect(sent[0]).toMatchObject({ windows: [3], rects: [], layers: ["dashi.agent-consent"] });
    const refusing = new AgentMask({
      ...deps,
      request: async () => {
        throw new Error("unknown method: capture-mask");
      },
    });
    await expect(refusing.update()).rejects.toThrow();
  });
});

describe("consent from the person only", () => {
  test("a yes counts only after the person's own recent press, with no agent press since", () => {
    expect(answeredByPerson({ person: 120, agent: null })).toBe(true);
    expect(answeredByPerson({ person: 120, agent: 5000 })).toBe(true);
    // An agent pressed there after the person did.
    expect(answeredByPerson({ person: 900, agent: 40 })).toBe(false);
    // Only an agent pressed.
    expect(answeredByPerson({ person: null, agent: 40 })).toBe(false);
    // The person's press was long ago.
    expect(answeredByPerson({ person: PERSON_PRESS_MS + 1, agent: null })).toBe(false);
    for (const nonsense of [null, "yes", {}, { person: "120" }, { person: -1, agent: null }]) expect(answeredByPerson(nonsense)).toBe(false);
  });

  test("it asks about the sheet's layer, and an error is a no", async () => {
    const asked: unknown[] = [];
    const ask = async (method: string, params: Record<string, unknown>) => {
      asked.push([method, params]);
      return { person: 10, agent: null };
    };
    expect(await personAnswered(ask, "dashi.agent-consent")).toBe(true);
    expect(asked).toEqual([["input-origin", { namespace: "dashi.agent-consent" }]]);
    expect(
      await personAnswered(async () => {
        throw new Error("old compositor");
      }, "dashi.agent-consent"),
    ).toBe(false);
  });
});
