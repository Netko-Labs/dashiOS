import { describe, expect, test } from "bun:test";
import { type A11yNode, focusedField, hasState, passwordFields, placeAgain, ROLE, STATE, toWindow } from "../src/agents/atspi/tree.ts";
import { AGENT_MASK, AgentMask, FIELD_PAD, type FilledField, maskRequest, SHEET_LAYERS } from "../src/agents/mask.ts";
import { answeredByPerson, PERSON_PRESS_MS, personAnswered } from "../src/agents/person.ts";
import type { CompositorWindow } from "../src/compositor.ts";
import { DBusError, ERRORS } from "../src/shared/dbus/index.ts";
import { bits, browser, tree } from "./fixtures/a11y-tree.ts";

function window(id: number, pid: number | null, appId = "firefox"): CompositorWindow {
  return {
    id,
    appId,
    title: `w${id}`,
    pid,
    focused: false,
    state: "normal",
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
    // The page has no extents in the made-up tree: the field is placed as the app says.
    expect(rects).toEqual([{ rect: { x: 100, y: 240, width: 240, height: 28 }, page: null }]);
  });

  test("the focused field comes with the addresses of the documents around it, innermost first", async () => {
    expect(await focusedField(browser("https://github.com/login"))).toMatchObject({ kind: "password", documents: ["https://github.com/login"] });
    expect(await focusedField(browser("https://github.com/login", { focus: "user" }))).toMatchObject({ kind: "text" });
    const framed = await focusedField(browser("https://evil.example/", { frameUrl: "https://github.com/login" }));
    expect(framed?.documents).toEqual(["https://github.com/login", "https://evil.example/"]);
    expect(await focusedField(browser("https://github.com/login", { focus: null }))).toBeNull();
  });

  test("a web field is placed in its window by its page, whatever units and origin the browser uses", () => {
    // Measured in the VM: Helium at scale 1.5, its window's content 596×436 points; the code field
    // shows at 88, 179 points in it, 436×36. Helium says (device pixels, from an origin of its own):
    const page = { x: 39, y: 81, width: 882, height: 596 };
    const field = { x: 165, y: 297, width: 654, height: 54 };
    const placed = toWindow(field, page, { width: 596, height: 436 });
    expect(Math.round(placed.x)).toBe(88);
    expect(Math.round(placed.y)).toBe(179);
    expect([Math.round(placed.width), Math.round(placed.height)]).toEqual([436, 36]);
    // Outside a web page, as the app says.
    expect(toWindow(field, null, { width: 596, height: 436 })).toEqual(field);
  });

  test("a field and its page that Firefox places only when asked twice are placed", async () => {
    const field = { x: 418, y: 310, width: 436, height: 35 };
    const page = { x: 26, y: 96, width: 1204, height: 614 };
    const firefox = tree({
      role: ROLE.APPLICATION,
      children: [
        {
          role: ROLE.FRAME,
          states: [STATE.SHOWING],
          children: [
            {
              role: ROLE.DOCUMENT_WEB,
              states: [STATE.SHOWING],
              url: "http://signin.localhost:8443/",
              rect: page,
              late: true,
              children: [{ role: ROLE.PASSWORD_TEXT, states: [STATE.SHOWING], rect: field, late: true }],
            },
          ],
        },
      ],
    });
    expect((await passwordFields(firefox)).rects).toEqual([{ rect: field, page }]);
  });

  test("a field found again: placed while it shows, hidden while not, gone with its page", async () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(await placeAgain(tree({ role: ROLE.ENTRY, states: [STATE.SHOWING], rect }), null)).toEqual({ rect, page: null });
    expect(await placeAgain(tree({ role: ROLE.ENTRY, states: [], rect }), null)).toBe("hidden");
    expect(await placeAgain(tree({ role: ROLE.ENTRY, states: [STATE.SHOWING, STATE.DEFUNCT], rect }), null)).toBe("gone");
    const forgotten = { ...tree({ role: ROLE.ENTRY }), states: () => Promise.reject(new DBusError(ERRORS.unknownObject, "unknown object")) };
    expect(await placeAgain(forgotten, null)).toBe("gone");
    const quit = { ...tree({ role: ROLE.ENTRY }), states: () => Promise.reject(new DBusError("org.freedesktop.DBus.Error.ServiceUnknown")) };
    expect(await placeAgain(quit, null)).toBe("gone");
  });

  test("a field whose query times out isn't gone: it stays blanked where it was", async () => {
    const slow = { ...tree({ role: ROLE.ENTRY }), states: () => Promise.reject(new DBusError(ERRORS.noReply, "no reply to GetState within 300 ms")) };
    await expect(placeAgain(slow, null)).rejects.toThrow("no reply");
    const sent: Array<Record<string, unknown>> = [];
    const forgotten: string[] = [];
    const rect = { x: 10, y: 40, width: 100, height: 20 };
    const mask = new AgentMask({
      captureMask: async (params) => sent.push(params),
      windows: async () => [window(3, null)],
      atspi: async () => null,
      handedOver: () => [],
      isVault: () => false,
      filled: () => [{ window: 3, rect, again: () => placeAgain(slow, null), forget: () => forgotten.push("slow") }],
    });
    await mask.update();
    expect((sent[0]?.rects as Array<{ y: number }>).map((r) => r.y + FIELD_PAD)).toEqual([40]);
    expect(forgotten).toEqual([]);
  });

  test("a field whose page the tab left is gone, though Chromium still answers for it", async () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    const field = tree({ role: ROLE.ENTRY, states: [STATE.SHOWING], rect });
    const page = (key: string, children: () => A11yNode[]): A11yNode => ({
      ...tree({ role: ROLE.DOCUMENT_WEB, states: [STATE.SHOWING], rect }),
      key,
      parent: async () => ({ ...tree({ role: ROLE.FRAME }), children: async () => children() }),
    });
    const left: A11yNode = page(":1.5/doc/164", () => [{ ...tree({ role: ROLE.DOCUMENT_WEB }), key: ":1.5/doc/183" }]);
    expect(await placeAgain(field, left)).toBe("gone");
    const staying: A11yNode = page(":1.5/doc/164", () => [{ ...tree({ role: ROLE.DOCUMENT_WEB }), key: ":1.5/doc/164" }]);
    expect(await placeAgain(field, staying)).toEqual({ rect, page: rect });
  });

  test("a walk gives up at its limits instead of holding a picture", async () => {
    const wide = tree({ role: ROLE.APPLICATION, children: Array.from({ length: 50 }, () => ({ role: ROLE.FRAME, states: [STATE.SHOWING] })) });
    const { complete } = await passwordFields(wide, { nodes: 10, deadline: Date.now() + 1000 });
    expect(complete).toBe(false);
  });
});

describe("what agents' pictures blank", () => {
  test("the request covers sheets, the vault, handed-over windows, and padded password fields", () => {
    const request = maskRequest({
      handedOver: [4],
      vault: [7, 4],
      fields: [{ window: 3, rect: { x: 100, y: 240, width: 240, height: 28 } }],
      pids: [999],
      popups: [3],
      opened: [8],
    });
    expect(request).toEqual({
      client: AGENT_MASK,
      windows: [4, 7, 8],
      rects: [{ window: 3, x: 100 - FIELD_PAD, y: 240 - FIELD_PAD, width: 240 + 2 * FIELD_PAD, height: 28 + 2 * FIELD_PAD }],
      layers: [...SHEET_LAYERS],
      pids: [999],
      popups: [3],
    });
    expect(SHEET_LAYERS).toContain("dashi.agent-consent");
  });

  test("an update finds password fields in each window's app and tells the compositor", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const mask = new AgentMask({
      captureMask: async (params) => {
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
    await new AgentMask({ ...deps, captureMask: async (p) => sent.push(p) }).update();
    expect(sent[0]).toMatchObject({ windows: [3], rects: [], layers: ["dashi.agent-consent"] });
    const refusing = new AgentMask({
      ...deps,
      captureMask: async () => {
        throw new Error("unknown method: capture-mask");
      },
    });
    await expect(refusing.update()).rejects.toThrow();
  });
});

describe("fields Dashi filled", () => {
  test("their blanks follow the field, leave while it's hidden, and go with its page", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const forgotten: string[] = [];
    const at = (y: number) => ({ x: 10, y, width: 100, height: 20 });
    const field = (name: string, again?: () => Promise<Awaited<ReturnType<NonNullable<FilledField["again"]>>>>): FilledField => ({
      window: 3,
      rect: at(1),
      again,
      forget: () => forgotten.push(name),
    });
    const mask = new AgentMask({
      captureMask: async (params) => sent.push(params),
      windows: async () => [window(3, null)],
      atspi: async () => null,
      handedOver: () => [],
      isVault: () => false,
      filled: () => [
        // Scrolled: blanked where it is now (no page: as the app says).
        field("moved", async () => ({ rect: at(50), page: null })),
        field("hidden", async () => "hidden"),
        field("gone", async () => "gone"),
        // Found nowhere in time, or never followed: blanked where it was.
        field("slow", () => new Promise(() => {})),
        field("plain"),
      ],
    });
    await mask.update();
    const ys = (sent[0]?.rects as Array<{ y: number }>).map((r) => r.y + FIELD_PAD);
    expect(ys).toEqual([50, 1, 1]);
    expect(forgotten).toEqual(["gone"]);
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
    expect(answeredByPerson({ person: -1, agent: null })).toBe(false);
  });

  test("it asks about the sheet's layer, and an error is a no", async () => {
    const asked: unknown[] = [];
    const ask = async (params: { namespace: string }) => {
      asked.push(["input-origin", params]);
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
