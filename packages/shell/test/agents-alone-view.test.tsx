/**
 * Work alone on screen: the menu bar's chip (alone-chip.tsx), counting down
 * and stopping at one click, and its section in Settings › Agents
 * (settings-app/lib/panes/agents-alone.tsx), on a stand-in for the Metal host.
 */

import { expect, test } from "bun:test";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AloneRecords } from "../src/agents/alone/records.ts";
import type { AloneRecord } from "../src/agents/alone/types.ts";
import { WorkAlone } from "../src/agents/alone/work-alone.ts";
import { Grants } from "../src/agents/consent.ts";
import { SiteGrants } from "../src/agents/sites.ts";
import { AloneChip, aloneTip, leftText } from "../src/alone-chip.tsx";
import type { PaneContext } from "../src/settings-app/context.ts";
import { NEVER_WORDS, ONLY_YOU_PICK, onWords, WorkAloneSection } from "../src/settings-app/lib/panes/agents-alone.tsx";
import { fakeClockEachTest, settle } from "./support/time.ts";

const clock = fakeClockEachTest();

async function mount(tree: ReactNode) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  // One root: the host draws a tree, not a list of them.
  const root: NativeRoot = render(
    <Appearance dark={false}>
      <View>{tree}</View>
    </Appearance>,
    transport,
  );
  await settle();
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  return {
    root,
    tree: (): string => root.lastTree() ?? "",
    has: (testID: string): boolean => Boolean(root.nodeId(testID)),
    press: (testID: string) => emit({ type: "press", nodeId: node(testID) }),
    type: (testID: string, value: string) => emit({ type: "change", nodeId: node(testID), value }),
  };
}

test("the chip's time is whole seconds, rounded up: never 0:00 while it is on", () => {
  expect(leftText(60_000, 0)).toBe("1:00");
  expect(leftText(60_000, 1)).toBe("1:00");
  expect(leftText(60_000, 59_001)).toBe("0:01");
  expect(leftText(4 * 3_600_000, 0)).toBe("4:00:00");
  expect(aloneTip("0:42")).toBe("Agents work alone · 0:42 left. Click to stop.");
});

test("the chip counts down each second, stops at one click, and goes when it ends", async () => {
  const alone = new WorkAlone({ personPressed: async () => true });
  await alone.start({ scopes: ["see"], sites: [], minutes: 1 });
  const Bar = () => <AloneChip state={alone.getSnapshot()} onStop={() => void alone.stop()} />;
  const view = await mount(<Bar />);
  expect(view.has("alone-chip")).toBe(true);
  expect(view.tree()).toContain("1:00");
  await clock.advance(1_000);
  expect(view.tree()).toContain("0:59");
  await clock.advance(17_000, 1_000);
  expect(view.tree()).toContain("0:42");
  await view.press("alone-chip");
  expect(alone.getSnapshot()).toEqual({ on: false });
  expect(alone.records.getSnapshot()[0]?.why).toBe("stopped");
  view.root.unmount();
  // Off, it draws nothing.
  const off = await mount(<AloneChip state={{ on: false }} onStop={() => {}} />);
  expect(off.has("alone-chip")).toBe(false);
  off.root.unmount();
});

function setup(pressed: () => Promise<boolean>) {
  const grants = new Grants(null);
  grants.set("/usr/bin/claude", new Set(["see", "screen", "signin"]));
  const sites = new SiteGrants(null);
  sites.allowAhead("bodytech.com.co");
  sites.add("/usr/bin/claude", "example.com");
  const alone = new WorkAlone({ personPressed: pressed, records: new AloneRecords(null) });
  const shown: AloneRecord[] = [];
  const ctx = { grants, sites, alone, showAloneRecord: (record: AloneRecord) => shown.push(record) } as unknown as PaneContext;
  return { alone, ctx, shown };
}

test("Settings starts from what was already allowed, and the switch turns it on for the person", async () => {
  const { alone, ctx } = setup(async () => true);
  const view = await mount(<WorkAloneSection ctx={ctx} />);
  expect(view.tree()).toContain("Let agents work alone");
  expect(view.tree()).toContain(NEVER_WORDS);
  // No tick for what it never covers.
  expect(view.has("alone-tools:see")).toBe(true);
  for (const never of ["pay", "signin", "clipboard"]) expect(view.has(`alone-tools:${never}`)).toBe(false);
  // Sites show once Use websites is ticked: the person's list and the agents' kept ones.
  expect(view.has("alone-sites")).toBe(false);
  await view.press("alone-tools:web");
  expect(view.has("alone-sites:bodytech.com.co")).toBe(true);
  expect(view.has("alone-sites:example.com")).toBe(true);
  await view.press("alone-sites:example.com");
  await view.press("alone-time:custom");
  await view.type("alone-custom", "1");
  await view.press("alone-switch");
  expect(alone.getSnapshot()).toMatchObject({ on: true, scopes: ["see", "screen", "web"], sites: ["bodytech.com.co"], throughLock: false });
  expect(alone.status().secondsLeft).toBe(60);
  // On: the row says until when and what; the picks are gone; the switch stops it.
  expect(view.tree()).toContain("Without asking: See windows and apps, See the screen, Use websites. On bodytech.com.co.");
  expect(view.has("alone-tools")).toBe(false);
  await view.press("alone-switch");
  expect(alone.getSnapshot()).toEqual({ on: false });
  // The picks are as the person left them, for a second run.
  expect(view.tree()).toContain('"value":"1"');
  await view.press("alone-switch");
  expect(alone.getSnapshot()).toMatchObject({ on: true, scopes: ["see", "screen", "web"], sites: ["bodytech.com.co"] });
  await view.press("alone-switch");
  // Its record is listed, with Show.
  const [record] = alone.records.getSnapshot();
  expect(alone.records.getSnapshot()).toHaveLength(2);
  expect(view.has(`alone-record:${record?.started}`)).toBe(true);
  expect(view.tree()).toContain("Agents did nothing");
  view.root.unmount();
});

test("a press that wasn't the person's turns nothing on, and the pane says why", async () => {
  const { alone, ctx } = setup(async () => false);
  const view = await mount(<WorkAloneSection ctx={ctx} />);
  await view.press("alone-switch");
  expect(alone.getSnapshot()).toEqual({ on: false });
  expect(view.tree()).toContain("Only you can turn this on. Press it yourself, here.");
  view.root.unmount();
});

test("an agent's press changes no pick: it can't widen what the person is about to turn on", async () => {
  let person = false;
  const { alone, ctx } = setup(async () => person);
  const view = await mount(<WorkAloneSection ctx={ctx} />);
  const ticked = (testID: string): boolean => {
    const find = (node: { props?: Record<string, unknown>; children?: unknown[] }): boolean | null => {
      const access = node.props?.id === view.root.nodeId(testID) ? node.props?.access : undefined;
      if (typeof access === "object" && access !== null) return "checked" in access && access.checked === true;
      for (const child of node.children ?? []) {
        const found = typeof child === "object" && child !== null ? find(child) : null;
        if (found !== null) return found;
      }
      return null;
    };
    return find(JSON.parse(view.tree())) === true;
  };
  expect([ticked("alone-tools:see"), ticked("alone-tools:act")]).toEqual([true, false]);
  // Not the person's: the ticks, the time, the lock switch and a typed time all stay.
  await view.press("alone-tools:act");
  await view.press("alone-tools:web");
  await view.press("alone-time:240");
  await view.press("alone-through-lock");
  expect(ticked("alone-tools:act")).toBe(false);
  expect(view.has("alone-sites")).toBe(false);
  expect(view.tree()).toContain(ONLY_YOU_PICK);
  // The person's own: they change, and the words go.
  person = true;
  await view.press("alone-tools:act");
  await view.press("alone-time:custom");
  await view.type("alone-custom", "900");
  expect(ticked("alone-tools:act")).toBe(true);
  expect(view.tree()).not.toContain(ONLY_YOU_PICK);
  // A custom time that is no time is refused, in words.
  expect(view.tree()).toContain("minutes, from 1 to 480");
  await view.press("alone-switch");
  expect(view.tree()).toContain("Pick a time from 1 minute to 8 hours.");
  // What the person had turned on is what they picked, never what the agent pressed.
  await view.type("alone-custom", "5");
  await view.press("alone-switch");
  expect(alone.getSnapshot()).toMatchObject({ on: true, scopes: ["see", "screen", "act"], throughLock: false });
  expect(alone.status().secondsLeft).toBe(300);
  view.root.unmount();
});

test("Show opens the whole record; the row's words say when it stays on at a lock", async () => {
  const { alone, ctx, shown } = setup(async () => true);
  await alone.start({ scopes: ["see"], sites: [], minutes: 1 });
  alone.note({ agent: "claude", tool: "list_windows", sites: [], outcome: "ok", free: true });
  const record = alone.stop();
  const view = await mount(<WorkAloneSection ctx={ctx} />);
  expect(view.tree()).toContain("1 action, 1 without asking");
  await view.press(`alone-record-show:${record?.started}`);
  expect(shown).toEqual(record ? [record] : []);
  expect(onWords({ on: true, started: 0, ends: 1, scopes: ["see"], sites: ["x.com"], throughLock: true }, "15:40")).toBe(
    "On until 15:40. Without asking: See windows and apps. It stays on when the screen locks.",
  );
  view.root.unmount();
});
