/** Sharing a character (settings-app/lib/panes/persona-share.tsx): a file somebody sent is read in full before it is added, and Export writes this Dashi as one file. */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { NO_STYLE, promptStyle, STYLE_CLOSE, systemPrompt } from "../src/agents/ask/answerer.ts";
import { charactersDir, checkCharacterFile, startPersona } from "../src/persona/index.ts";
import { PersonaPane } from "../src/settings-app/lib/panes/persona.tsx";
import { PaneStoresContext } from "../src/settings-app/lib/setting.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/index.ts";
import { createPillHub } from "../src/shared/pill/index.ts";
import { settle } from "./support/time.ts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-persona-share-"));
});
afterAll(() => {
  promptStyle.set(NO_STYLE);
  rmSync(dir, { recursive: true, force: true });
});

/** The pane over a settings file of its own, with file dialogs that answer what the test says. */
async function pane(person: { is: boolean }) {
  const home = mkdtempSync(join(dir, "home-"));
  const file = join(home, "settings.json");
  writeFileSync(file, "{}");
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
  const picks: { add: string | null; save: string | null; offered: string[] } = { add: null, save: null, offered: [] };
  const dialogs = {
    choose: async () => picks.add,
    save: async (name: string) => {
      picks.offered.push(name);
      return picks.save;
    },
  };
  const listeners = new Set<(event: NativeEvent) => void>();
  const transport: NativeTransport = { send() {}, onEvent: (listener) => void listeners.add(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(
    <Appearance dark={false}>
      <View style={{ width: 760, height: 900 }}>
        <PaneStoresContext.Provider value={{ settings, flags: new FlagsStore(join(home, "flags.json")) }}>
          <PersonaPane settings={settings} persona={{ source, openFile() {}, dialogs }} byPerson={async () => person.is} />
        </PaneStoresContext.Provider>
      </View>
    </Appearance>,
    transport,
  );
  await settle();
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const view = {
    tree: (): string => root.lastTree() ?? "",
    has: (testID: string): boolean => Boolean(root.nodeId(testID)),
    press: (testID: string) => emit({ type: "press", nodeId: node(testID) }),
    submit: (testID: string, value: string) => emit({ type: "submit", nodeId: node(testID), value }),
  };
  return { view, hub, source, home, picks, data: () => settings.getSnapshot().data };
}

const ABUELA = {
  dashiCharacter: 1,
  id: "abuela",
  name: "Abuela",
  about: { en: "Fusses over you, then gets it done." },
  prompt: { en: "You speak like a loving grandmother.", es: "Hablas como una abuela cariñosa." },
  colour: "berry",
  mark: "leaf",
  dots: "smile",
  motion: "warm",
  // What a file may not carry: none of it arrives.
  svg: "<svg onload=steal()>",
  tools: ["send_without_asking"],
};

test("Add a File…: the whole text is shown first, Cancel copies nothing, Add copies text and ids only and chooses it", async () => {
  const { view, data, picks, home, source, hub } = await pane({ is: true });
  picks.add = join(home, "from-a-friend.json");
  writeFileSync(picks.add, JSON.stringify(ABUELA));
  await view.press("persona-add-file");
  expect(view.tree()).toContain("Add “Abuela”?");
  expect(view.tree()).toContain("This is what your agent will be told:");
  expect(view.tree()).toContain("You speak like a loving grandmother.");
  expect(view.tree()).toContain("Hablas como una abuela cariñosa.");
  // Nothing is copied or chosen while it is only being read.
  expect(existsSync(join(source.dir, "abuela.json"))).toBe(false);
  await view.press("persona-add:cancel");
  expect(existsSync(join(source.dir, "abuela.json"))).toBe(false);
  expect(data().persona).toEqual({});
  await view.press("persona-add-file");
  await view.press("persona-add:ok");
  const copied = readFileSync(join(source.dir, "abuela.json"), "utf8");
  expect(copied).not.toContain("svg");
  expect(copied).not.toContain("send_without_asking");
  expect(data().persona).toEqual({ character: "abuela" });
  expect(hub.persona.getSnapshot().prompt).toContain("You speak like a loving grandmother.");
  expect(systemPrompt().endsWith(STYLE_CLOSE)).toBe(true);
  // The same file again: the one that is here is not replaced.
  await view.press("persona-add-file");
  await view.press("persona-add:ok");
  expect(view.tree()).toContain("was not added: you already have one with its id.");
});

test("Add a File…: a file that is not a character is refused in words, and no sheet opens", async () => {
  const { view, picks, home, source } = await pane({ is: true });
  picks.add = join(home, "big.json");
  writeFileSync(picks.add, JSON.stringify({ ...ABUELA, prompt: { en: "x".repeat(9000) } }));
  await view.press("persona-add-file");
  expect(view.tree()).toContain("This file is not a character: it is larger than 8 KB.");
  expect(view.has("persona-add")).toBe(false);
  expect(existsSync(join(source.dir, "abuela.json"))).toBe(false);
});

test("Export…: this Dashi as one file, with its own name, colour, mark and dots; an agent's press writes nothing", async () => {
  const { view, picks, home } = await pane({ is: true });
  await view.press("persona-character-choice:wasabi");
  await view.submit("persona-name-field", "Pixel");
  await view.press("persona-colour:berry");
  await view.press("persona-mark:paw");
  await view.press("persona-dots:hop");
  await view.submit("persona-you-field", "Alex");
  picks.save = join(home, "pixel.json");
  await view.press("persona-export");
  expect(picks.offered).toEqual(["pixel.json"]);
  const text = readFileSync(picks.save, "utf8");
  // What it calls the person stays here.
  expect(text).not.toContain("Alex");
  const read = checkCharacterFile(text);
  expect(read.ok && read.character).toMatchObject({ id: "pixel", name: "Pixel", colour: "berry", mark: "paw", dots: "hop", motion: "dry", talk: "less" });
  expect(read.ok && read.character.prompt.en).toContain("dry, quick and honest");
  expect(view.tree()).toContain("Exported “Pixel”.");
  const agent = await pane({ is: false });
  agent.picks.save = join(agent.home, "no.json");
  agent.picks.add = picks.save;
  await agent.view.press("persona-export");
  await agent.view.press("persona-add-file");
  expect(existsSync(agent.picks.save)).toBe(false);
  expect(agent.view.has("persona-add")).toBe(false);
  expect(agent.picks.offered).toEqual([]);
});
