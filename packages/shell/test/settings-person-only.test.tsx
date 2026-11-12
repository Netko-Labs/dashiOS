/**
 * Changes only the person makes in System Settings (settings-app/lib/person-only.ts): an agent that may click
 * in windows presses what it likes, and where a wrong press costs something the pane asks the compositor
 * whose press it was. Settings › Voice (the switch, Fetch, Remove, the key, the voice), "Sites agents may
 * use", "Don't ask for these again". And the Voice switch reads on only when Voice is on.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { SiteGrants } from "../src/agents/sites.ts";
import { AgentSitesSection } from "../src/settings-app/lib/panes/agents-sites.tsx";
import { switchDetail, VoicePane } from "../src/settings-app/lib/panes/voice.tsx";
import { ONLY_YOU, personOnly } from "../src/settings-app/lib/person-only.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { VoiceModels } from "../src/voice/models.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-person-only-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Node {
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, id: string): Node | undefined {
  if (node.props.id === id) return node;
  for (const child of node.children ?? []) {
    const found = isNode(child) ? find(child, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

async function mount(tree: ReactNode) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
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
    /** Whether the switch `testID` reads on, as a screen reader hears it. */
    reads: (testID: string): unknown => {
      const access = find(JSON.parse(root.lastTree() ?? "{}") as Node, node(testID))?.props.access;
      return isNode({ props: access }) && typeof access === "object" && access !== null && "checked" in access ? access.checked : undefined;
    },
  };
}

const set = (id: string, basic: boolean, bytes: number, have: number) => ({
  id,
  name: id === "listen" ? "Listening" : id === "speak" ? "Speaking" : "More languages",
  about: `About ${id}.`,
  credit: `Credit ${id}.`,
  basic,
  bytes,
  have,
  installed: have === bytes,
});

/** Settings › Voice on a scripted service: its models here or not, and whose press it is. */
async function voicePane(here: boolean, person: { is: boolean }) {
  const state = { have: here ? 1 : 0 };
  const voice = fakeVoice({
    models: () => ({
      folder: "/home/alexk/.local/share/dashi/voice",
      fetching: false,
      sets: [set("listen", true, 600, 600 * state.have), set("speak", true, 400, 400 * state.have), set("whisper", false, 1000, 0)],
    }),
    voices: {
      default: "af_heart",
      voices: [
        { id: "af_heart", name: "Heart", language: "en-US", language_name: "English (US)", installed: true },
        { id: "bf_emma", name: "Emma", language: "en-GB", language_name: "English (UK)", installed: true },
      ],
    },
    fetch: () => ({ bytes: 1000, fetching: true }),
  });
  const models = new VoiceModels(voice.service);
  await models.refresh();
  const settings = new SettingsStore(join(dir, `settings-${Math.random()}.json`));
  const sampled: string[] = [];
  const view = await mount(<VoicePane settings={settings} voice={{ models, sample: (id) => sampled.push(id) }} byPerson={async () => person.is} />);
  return { view, voice, settings, state, on: () => settings.getSnapshot().data.voice.on === true };
}

test("a change is made for the person, and for nobody else", async () => {
  const made: string[] = [];
  expect(
    await personOnly(
      async () => true,
      () => made.push("person"),
    ),
  ).toBe(true);
  expect(
    await personOnly(
      async () => false,
      () => made.push("agent"),
    ),
  ).toBe(false);
  // Not knowing is a no.
  expect(
    await personOnly(
      () => Promise.reject(new Error("no answer")),
      () => made.push("unknown"),
    ),
  ).toBe(false);
  // No compositor to ask: no agent's pointer either.
  expect(await personOnly(undefined, () => made.push("alone"))).toBe(true);
  expect(made).toEqual(["person", "alone"]);
});

test("the Voice switch's row says what it waits for, or that the press was not the person's", () => {
  expect(switchDetail({ wanted: false, usable: false, refused: false })).toBeUndefined();
  expect(switchDetail({ wanted: true, usable: true, refused: false })).toBeUndefined();
  expect(switchDetail({ wanted: true, usable: false, refused: false })).toBe("It turns on once its models are here.");
  expect(switchDetail({ wanted: false, usable: false, refused: true })).toBe(ONLY_YOU);
});

test("an agent's press on the Voice switch or on Fetch changes nothing, and the row says why", async () => {
  const person = { is: false };
  const { view, voice, on } = await voicePane(false, person);
  await view.press("voice-switch");
  // Nothing is offered, nothing is on, and the switch's row says so.
  expect(view.has("voice-models-fetch")).toBe(false);
  expect(view.tree()).toContain(ONLY_YOU);
  expect(on()).toBe(false);
  // The person presses it: what would come and how big, and Fetch. The reason is gone.
  person.is = true;
  await view.press("voice-switch");
  expect(view.has("voice-models-fetch")).toBe(true);
  expect(view.tree()).not.toContain(ONLY_YOU);
  // The agent presses Fetch: no gigabyte comes, and Voice is not on.
  person.is = false;
  await view.press("voice-models-fetch");
  expect(voice.calls).not.toContain("fetch");
  expect(on()).toBe(false);
  expect(view.tree()).toContain(ONLY_YOU);
  person.is = true;
  await view.press("voice-models-fetch");
  expect(voice.calls).toContain("fetch");
  expect(on()).toBe(true);
  view.root.unmount();
});

test("the switch reads on only when Voice is on, never while it offers or waits for the fetch", async () => {
  const person = { is: true };
  const { view, on } = await voicePane(false, person);
  expect(view.reads("voice-switch")).toBe(false);
  await view.press("voice-switch");
  // Offering the fetch: still off.
  expect(view.has("voice-models-fetch")).toBe(true);
  expect(view.reads("voice-switch")).toBe(false);
  await view.press("voice-models-fetch");
  // Asked for, its models not here yet: off, and the row says what it waits for.
  expect(on()).toBe(true);
  expect(view.reads("voice-switch")).toBe(false);
  expect(view.tree()).toContain("It turns on once its models are here.");
  // A press now takes the ask back.
  await view.press("voice-switch");
  expect(on()).toBe(false);
  view.root.unmount();
  // With its models here, on is on.
  const here = await voicePane(true, person);
  expect(here.view.reads("voice-switch")).toBe(false);
  await here.view.press("voice-switch");
  expect(here.on()).toBe(true);
  expect(here.view.reads("voice-switch")).toBe(true);
  expect(here.view.has("voice-key")).toBe(true);
  here.view.root.unmount();
});

test("an agent can't remove the models or pick the key or the voice; it can turn Voice off", async () => {
  const person = { is: true };
  const { view, voice, settings, on } = await voicePane(true, person);
  await view.press("voice-switch");
  person.is = false;
  await view.press("voice-key-choice:caps-lock");
  expect(settings.getSnapshot().data.voice.key).toBeUndefined();
  await view.press("voice-voice-choice:bf_emma");
  expect(settings.getSnapshot().data.voice.voice).toBeUndefined();
  await view.press("voice-models-remove");
  await view.press("voice-models-remove:confirm");
  expect(voice.calls).not.toContain("remove");
  expect(view.tree()).toContain(ONLY_YOU);
  // The person's own presses do each.
  person.is = true;
  await view.press("voice-key-choice:caps-lock");
  expect(settings.getSnapshot().data.voice.key).toBe("caps-lock");
  await view.press("voice-voice-choice:bf_emma");
  expect(settings.getSnapshot().data.voice.voice).toBe("bf_emma");
  // Turning it off only narrows: anyone may.
  person.is = false;
  await view.press("voice-switch");
  expect(on()).toBe(false);
  view.root.unmount();
});

test("only the person adds a site agents may use; anyone removes one", async () => {
  const sites = new SiteGrants(null);
  sites.allowAhead("bodytech.com.co");
  const person = { is: false };
  const view = await mount(<AgentSitesSection sites={sites} byPerson={async () => person.is} />);
  await view.press("agents-site-add");
  await view.type("agents-site-field", "example.com");
  await view.press("agents-site-add-button");
  expect(sites.ahead()).toEqual(["bodytech.com.co"]);
  expect(view.tree()).toContain(ONLY_YOU);
  person.is = true;
  await view.press("agents-site-add-button");
  expect(sites.ahead()).toContain("example.com");
  expect(view.tree()).not.toContain(ONLY_YOU);
  person.is = false;
  await view.press("agents-site-remove:example.com");
  expect(sites.ahead()).toEqual(["bodytech.com.co"]);
  view.root.unmount();
});
