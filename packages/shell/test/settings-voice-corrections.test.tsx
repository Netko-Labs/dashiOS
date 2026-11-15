/**
 * Settings › Voice's Corrections row (docs/dictation-rewrite.md, "The fetch"): the model that corrects
 * dictation is offered beside the speech models, with its size and its licence in words, fetched by
 * its own press and never with "More languages"; once here, the speed test's word is said.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import { MODEL } from "../src/rewrite/lib/model.ts";
import { speedWord } from "../src/rewrite/speed-word.ts";
import { VoicePane } from "../src/settings-app/lib/panes/voice.tsx";
import { correctionsOffer, speedWords } from "../src/settings-app/lib/panes/voice-words.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { VoiceModels } from "../src/voice/models.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-corrections-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const set = (id: string, name: string, basic: boolean, bytes: number, have: number) => ({
  id,
  name,
  about: `About ${id}.`,
  credit: `Credit ${id}.`,
  basic,
  bytes,
  have,
  installed: have === bytes,
});

async function pane(rewriteHave: number) {
  const voice = fakeVoice({
    models: () => ({
      folder: "/home/alexk/.local/share/dashi/voice",
      fetching: false,
      sets: [
        set("listen", "Listening", true, 600, 600),
        set("speak", "Speaking", true, 400, 400),
        set("whisper", "More languages", false, 1_000_000_000, 0),
        set("rewrite", "Corrections", false, 541_903_616, rewriteHave),
      ],
    }),
    voices: { default: "af_heart", voices: [] },
    fetch: () => ({ bytes: 541_903_616, fetching: true }),
  });
  const models = new VoiceModels(voice.service);
  await models.refresh();
  const settings = new SettingsStore(join(dir, `settings-${Math.random()}.json`));
  settings.patch("voice", { on: true });
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(
    <Appearance dark={false}>
      <View>
        <VoicePane settings={settings} voice={{ models, sample() {} }} byPerson={async () => true} />
      </View>
    </Appearance>,
    transport,
  );
  await settle();
  const press = async (testID: string): Promise<void> => {
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
    await settle();
  };
  return { voice, press, tree: (): string => root.lastTree() ?? "", has: (testID: string): boolean => Boolean(root.nodeId(testID)) };
}

test("the row offers the model with its size and its licence in words, and its press fetches that set alone", async () => {
  const { voice, press, tree, has } = await pane(0);
  expect(has("voice-corrections")).toBe(true);
  expect(tree()).toContain(
    "About rewrite. Optional: 542 MB, fetched once. The model is free to use and to share (Apache 2.0). Until it is here, dictation tidies by rule.",
  );
  // "More languages" neither names it nor counts its bytes.
  expect(tree()).toContain("About whisper. Optional: More languages (1.00 GB).");
  expect(tree()).toContain("Credit rewrite.");
  await press("voice-corrections-fetch");
  expect(voice.calls).toContain("fetch:rewrite");
  expect(voice.calls).not.toContain("fetch:whisper");
});

test("once it is here the row says so, and offers Remove for that set alone", async () => {
  const { voice, press, tree } = await pane(541_903_616);
  expect(tree()).toContain("On this computer: Corrections.");
  await press("voice-corrections-remove");
  await press("voice-corrections-remove:confirm");
  expect(voice.calls).toContain("remove:rewrite");
});

test("what a part-fetched model still needs is what the offer says", () => {
  const offer = correctionsOffer([set("rewrite", "Corrections", false, 541_903_616, 141_903_616)]);
  expect(offer).toContain("Optional: 400 MB, fetched once.");
});

test("the speed test's word: nothing when it is quick or not timed, a sentence when words land first or the model is not used", () => {
  expect(speedWords("untimed")).toBe("");
  expect(speedWords("quick")).toBe("");
  expect(speedWords("refines")).toBe(" It takes a moment here: your words land first, and are corrected right after.");
  expect(speedWords("too-slow")).toBe(" This computer is too slow for it, so dictation tidies by rule.");
  const state = join(dir, "state");
  const env = { XDG_STATE_HOME: state };
  expect(speedWord(env)).toBe("untimed");
  mkdirSync(join(state, "dashi"), { recursive: true });
  const write = (ms: number, model: string = MODEL.file): void => writeFileSync(join(state, "dashi", "rewrite-speed.json"), JSON.stringify({ model, ms }));
  write(240);
  expect(speedWord(env)).toBe("quick");
  write(1400);
  expect(speedWord(env)).toBe("refines");
  write(3000);
  expect(speedWord(env)).toBe("too-slow");
  // Another model's time says nothing of this one.
  write(3000, "other.gguf");
  expect(speedWord(env)).toBe("untimed");
  writeFileSync(join(state, "dashi", "rewrite-speed.json"), "not json");
  expect(speedWord(env)).toBe("untimed");
});
