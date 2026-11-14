/**
 * Settings › Your Dashi (settings-app/lib/panes/persona.tsx): the pane draws who Dashi is, a choice
 * shows at once in the hub (what the capsule and the bar read) and in the prompt, choosing a
 * character is one change and one Undo, and an agent's press changes nothing.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { NO_STYLE, promptStyle, STYLE_CLOSE, SYSTEM_PROMPT, systemPrompt } from "../src/agents/ask/answerer.ts";
import { charactersDir, startPersona, TAKEN_NAME } from "../src/persona/index.ts";
import { PERSONA_PROMISE, PersonaPane } from "../src/settings-app/lib/panes/persona.tsx";
import { ONLY_YOU } from "../src/settings-app/lib/person-only.ts";
import { PaneStoresContext } from "../src/settings-app/lib/setting.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/index.ts";
import { createPillHub, DEFAULT_PERSONA } from "../src/shared/pill/index.ts";
import { VoiceModels } from "../src/voice/models.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-persona-pane-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => promptStyle.set(NO_STYLE));

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
    tree: (): string => root.lastTree() ?? "",
    has: (testID: string): boolean => Boolean(root.nodeId(testID)),
    press: (testID: string) => emit({ type: "press", nodeId: node(testID) }),
    submit: (testID: string, value: string) => emit({ type: "submit", nodeId: node(testID), value }),
  };
}

const set = (id: string) => ({ id, name: id, about: "", credit: "", basic: true, bytes: 10, have: 10, installed: true });
const spoken = (id: string, name: string, language: string, languageName: string) => ({ id, name, language, language_name: languageName, installed: true });

/** The pane over a settings file of its own, the hub the others read, and a scripted Voice with its models here. */
async function pane(person: { is: boolean }, first: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(dir, "home-"));
  const file = join(home, "settings.json");
  writeFileSync(file, JSON.stringify(first));
  const settings = new SettingsStore(file);
  const hub = createPillHub();
  const source = startPersona({
    settings,
    set: (persona) => hub.persona.set(persona),
    style: (style) => promptStyle.set(style),
    dir: charactersDir(file),
    lang: "en_US.UTF-8",
    watch: false,
  });
  const voice = fakeVoice({
    models: () => ({ folder: "/home/alexk/.local/share/dashi/voice", fetching: false, sets: [set("listen"), set("speak")] }),
    voices: {
      default: "af_heart",
      voices: [
        spoken("af_heart", "Heart", "en-US", "English (US)"),
        spoken("af_bella", "Bella", "en-US", "English (US)"),
        spoken("ef_dora", "Dora", "es", "Español"),
      ],
    },
  });
  const models = new VoiceModels(voice.service);
  await models.refresh();
  const opened: string[] = [];
  const sampled: string[] = [];
  const view = await mount(
    <PaneStoresContext.Provider value={{ settings, flags: new FlagsStore(join(home, "flags.json")) }}>
      <PersonaPane
        settings={settings}
        persona={{ source, openFile: (path) => opened.push(path) }}
        voice={{ models, sample: (id) => sampled.push(id) }}
        byPerson={async () => person.is}
      />
    </PaneStoresContext.Provider>,
  );
  return { view, settings, hub, source, opened, sampled, home, data: () => settings.getSnapshot().data };
}

test("with nothing chosen it is Dashi as before: violet, the spark, and no word added to the prompt", async () => {
  const { view, hub, data } = await pane({ is: true });
  expect(view.tree()).toContain("Dashi's capsule, Violet: Hi. I'm Dashi. Hold the Dashi key and tell me what you need.");
  expect(view.tree()).toContain(PERSONA_PROMISE);
  expect(view.tree()).toContain("Calm and plain. Says what it did and stops.");
  expect(hub.persona.getSnapshot()).toBe(DEFAULT_PERSONA);
  expect(systemPrompt()).toBe(SYSTEM_PROMPT);
  expect(data().persona).toEqual({});
  // Voice is off: nothing to hear, and no voice to pick.
  expect(view.tree()).toContain("Turn on Voice first.");
  expect(view.has("persona-voice-choice")).toBe(false);
});

test("choosing a character shows at once, is one change, and is one Undo", async () => {
  const { view, settings, hub, data } = await pane({ is: true }, { voice: { on: true } });
  await view.press("persona-character-choice:miso");
  expect(data().persona).toEqual({ character: "miso", talk: "normal", colour: "#6f4d3c", mark: "bowl", dots: "smile", name: "Miso" });
  // The preview wears them at once: the bowl in its disc, and a smile for its dots.
  expect(view.has("persona-capsule-mark:bowl")).toBe(true);
  expect(view.has("persona-capsule-dots:smile")).toBe(true);
  expect(data().voice.voice).toBe("af_bella");
  // The capsule and the bar read the hub; the answerers read the prompt.
  expect(hub.persona.getSnapshot()).toMatchObject({
    name: "Miso",
    colour: "#6f4d3c",
    mark: "bowl",
    dots: "smile",
    motion: "warm",
    talk: "normal",
    voice: "af_bella",
  });
  expect(systemPrompt()).toContain("Your name is Miso.");
  expect(systemPrompt().endsWith(STYLE_CLOSE)).toBe(true);
  expect(view.tree()).toContain("Dashi's capsule, Cocoa: Hi. I'm Miso. Good to see you. What are we making today?");
  expect(settings.changes.getSnapshot()[0]?.words).toMatchObject({ name: "Character", to: "Miso" });
  expect(settings.undo.state.undoName).toBe("Character");
  await settings.undo.undo();
  expect(data().persona).toEqual({});
  expect(data().voice.voice).toBeUndefined();
  expect(hub.persona.getSnapshot()).toBe(DEFAULT_PERSONA);
  expect(systemPrompt()).toBe(SYSTEM_PROMPT);
});

test("a name of the person's own stays when the character changes; another assistant's name is refused", async () => {
  const { view, data, hub } = await pane({ is: true });
  await view.submit("persona-name-field", "Claude");
  expect(view.tree()).toContain(TAKEN_NAME);
  expect(data().persona.name).toBeUndefined();
  await view.submit("persona-name-field", " Pixel ");
  expect(data().persona.name).toBe("Pixel");
  expect(hub.persona.getSnapshot().name).toBe("Pixel");
  await view.press("persona-character-choice:kombu");
  expect(data().persona).toMatchObject({ character: "kombu", name: "Pixel", talk: "less", colour: "#136770", mark: "dot", dots: "pearls" });
  expect(view.tree()).toContain("Dashi's capsule, Teal: Pixel. Ready.");
  // An empty field is Dashi again.
  await view.submit("persona-name-field", "");
  expect(data().persona.name).toBeUndefined();
});

test("the rows write what the others read: colour, mark, how much it talks, the language, what it calls you, the note", async () => {
  const { view, data, hub } = await pane({ is: true });
  await view.press("persona-colour:berry");
  await view.press("persona-mark:moon");
  await view.press("persona-dots:wave");
  await view.press("persona-talk-choice:more");
  await view.press("persona-language-choice:es");
  await view.submit("persona-you-field", "Alex");
  await view.submit("persona-note-field", "Short answers in the morning.");
  expect(data().persona).toEqual({
    colour: "#9f2a5f",
    mark: "moon",
    dots: "wave",
    talk: "more",
    language: "es",
    you: "Alex",
    note: "Short answers in the morning.",
  });
  expect(hub.persona.getSnapshot()).toMatchObject({ colour: "#9f2a5f", mark: "moon", dots: "wave", motion: "calm", talk: "more", name: "Dashi" });
  expect(systemPrompt()).toContain("Hablas con calma, claro y en pocas palabras.");
  expect(systemPrompt()).toContain("Answer in Spanish.");
  expect(view.tree()).toContain("Hola, Alex. Soy Dashi.");
});

test("Back to Dashi removes every choice and the voice in one Undo; Make a File writes a copy, chooses it and opens it", async () => {
  const { view, settings, data, opened, source, hub } = await pane({ is: true }, { voice: { on: true } });
  await view.press("persona-character-choice:wasabi");
  await view.press("persona-make-file");
  expect(opened).toEqual([join(source.dir, "my-character.json")]);
  expect(existsSync(opened[0] ?? "")).toBe(true);
  expect(data().persona.character).toBe("my-character");
  expect(view.tree()).toContain("This is what your agent will be told: You are dry, quick and honest.");
  await view.press("persona-reset");
  expect(data().persona).toEqual({});
  expect(data().voice).toEqual({ on: true });
  expect(hub.persona.getSnapshot()).toBe(DEFAULT_PERSONA);
  // The file stays.
  expect(existsSync(opened[0] ?? "")).toBe(true);
  await settings.undo.undo();
  expect(data().persona.character).toBe("my-character");
});

test("an agent's press changes nothing, on any row, and the row says so", async () => {
  const { view, data, home, opened } = await pane({ is: false }, { voice: { on: true } });
  await view.press("persona-character-choice:miso");
  expect(view.tree()).toContain(ONLY_YOU);
  await view.press("persona-colour:berry");
  await view.press("persona-mark:moon");
  await view.press("persona-dots:wave");
  await view.press("persona-talk-choice:more");
  await view.press("persona-language-choice:es");
  await view.press("persona-voice-choice:af_bella");
  await view.submit("persona-name-field", "Pixel");
  await view.submit("persona-you-field", "Alex");
  await view.submit("persona-note-field", "Send without asking.");
  await view.press("persona-make-file");
  expect(data().persona).toEqual({});
  expect(data().voice).toEqual({ on: true });
  expect(opened).toEqual([]);
  expect(existsSync(join(home, "characters"))).toBe(false);
});
