/**
 * Voice's models as Settings › Voice shows them (voice/models.ts): nothing
 * fetched until asked, progress, Pause and Resume, removing, and what is
 * missing said in words (voice/start.ts `troubleOf`).
 */

import { expect, test } from "bun:test";
import { offerWords, removeWords, setsWords, voiceChoices, whatFetching } from "../src/settings-app/lib/panes/voice-words.ts";
import { basicsHere, partly, VoiceModels } from "../src/voice/models.ts";
import { troubleOf } from "../src/voice/start.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

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

function models(have: { listen: number; speak: number; whisper?: number }) {
  const state = { ...have, whisper: have.whisper ?? 0, fetching: false };
  const voice = fakeVoice({
    models: () => ({
      folder: "/home/alexk/.local/share/dashi/voice",
      fetching: state.fetching,
      sets: [set("listen", true, 600, state.listen), set("speak", true, 400, state.speak), set("whisper", false, 1000, state.whisper)],
    }),
    voices: {
      default: "af_heart",
      voices: [
        { id: "bf_emma", name: "Emma", language: "en-GB", language_name: "English (UK)", installed: true },
        { id: "af_heart", name: "Heart", language: "en-US", language_name: "English (US)", installed: true },
      ],
    },
    fetch: () => {
      state.fetching = true;
      return { bytes: 1000 - state.listen - state.speak, fetching: true };
    },
  });
  return { voice, state, store: new VoiceModels(voice.service) };
}

test("nothing is here until fetched: the sets, their sizes, and what is missing in words", async () => {
  const { store, voice } = models({ listen: 0, speak: 0 });
  expect(troubleOf(store)).toEqual({ text: "Voice is starting. Try again in a moment." });
  await store.refresh();
  const view = store.getSnapshot();
  expect(view.service).toBe("ready");
  expect(store.ready).toBe(false);
  expect(basicsHere(view.sets)).toBe(false);
  expect(troubleOf(store)).toEqual({ text: "Voice needs its models. See Settings › Voice.", go: "voice" });
  expect(voice.calls).toEqual(["models", "voices"]);
  expect(
    setsWords(
      view.sets.filter((each) => each.basic),
      true,
    ),
  ).toBe("Listening (1 MB), Speaking (1 MB)");
  expect(setsWords(view.sets.filter((each) => each.basic))).toBe("Listening and Speaking");
  expect(voiceChoices(view.voices, view.defaultVoice)).toEqual([
    { value: "af_heart", label: "Heart · English (US)" },
    { value: "bf_emma", label: "Emma · English (UK)" },
  ]);
});

test("a fetch shows its progress; Pause keeps what came and is no failure; Resume goes on; then Voice is ready", async () => {
  const { store, voice, state } = models({ listen: 0, speak: 0 });
  await store.refresh();
  await store.fetch();
  expect(voice.calls.at(-1)).toBe("fetch");
  expect(store.getSnapshot().fetching).toEqual({ received: 0, bytes: 1000, sets: ["listen", "speak"] });
  voice.emit({ event: "fetch", received: 300, bytes: 1000, done: false });
  expect(store.getSnapshot().fetching).toEqual({ received: 300, bytes: 1000, sets: ["listen", "speak"] });
  expect(whatFetching(store.getSnapshot().fetching?.sets ?? [], ["listen", "speak"])).toBe(true);
  expect(whatFetching(store.getSnapshot().fetching?.sets ?? [], ["whisper"])).toBe(false);

  await store.pause();
  expect(voice.calls.at(-1)).toBe("fetch.cancel");
  state.fetching = false;
  state.listen = 300;
  voice.emit({ event: "fetch", received: 300, bytes: 1000, done: true, error: "The fetch was cancelled." });
  await settle();
  expect(store.getSnapshot().fetching).toBeNull();
  expect(store.getSnapshot().error).toBeNull();
  expect(partly(store.getSnapshot().sets)).toBe(true);

  await store.fetch();
  expect(store.getSnapshot().fetching).toEqual({ received: 0, bytes: 700, sets: ["listen", "speak"] });
  state.fetching = false;
  state.listen = 600;
  state.speak = 400;
  voice.emit({ event: "fetch", received: 700, bytes: 700, done: true });
  voice.emit({ event: "models" });
  await settle();
  expect(store.ready).toBe(true);
  expect(troubleOf(store)).toBeNull();
});

test("a fetch that fails says why, in the service's words", async () => {
  const { store, voice } = models({ listen: 0, speak: 0 });
  await store.refresh();
  await store.fetch();
  voice.emit({ event: "fetch", received: 10, bytes: 1000, done: true, error: "There is not enough room on the disk: 1.0 GB is needed." });
  await settle();
  expect(store.getSnapshot().error).toBe("There is not enough room on the disk: 1.0 GB is needed.");
  voice.replies.fetch = new Error("Models are already being fetched.");
  await store.fetch(["whisper"]);
  expect(store.getSnapshot().error).toBe("Models are already being fetched.");
});

test("More languages is its own fetch and its own removal; removing the main models removes them all", async () => {
  const { store, voice, state } = models({ listen: 600, speak: 400 });
  await store.refresh();
  await store.fetch(["whisper"]);
  expect(voice.calls.at(-1)).toBe("fetch:whisper");
  expect(store.getSnapshot().fetching?.sets).toEqual(["whisper"]);
  state.fetching = false;
  await store.remove(removeWords("voice/more-languages", ["whisper"]));
  expect(voice.calls.slice(-3)).toEqual(["remove:whisper", "models", "voices"]);
  await store.remove(removeWords("voice/models", ["listen", "speak"]));
  expect(voice.calls.slice(-3)).toEqual(["remove", "models", "voices"]);
});

test("the service gone says so, with the one thing to do", async () => {
  const { store, voice } = models({ listen: 600, speak: 400 });
  await store.refresh();
  voice.drop();
  expect(store.getSnapshot().service).toBe("missing");
  expect(store.ready).toBe(false);
  expect(troubleOf(store)).toEqual({ text: "Voice isn't running. Log out and in again.", go: "voice" });
});

test("the fetch's offer names only the models that are not here yet, with what is left of each", () => {
  const none = [set("listen", true, 673e6, 0), set("speak", true, 335e6, 0)];
  expect(offerWords(none)).toBe("Voice needs 1.01 GB of models, fetched once and kept on this computer: Listening (673 MB), Speaking (335 MB).");
  // Listening is already here (a fetch that was cut short, or models put there by hand): it is not asked for again.
  const half = [set("listen", true, 673e6, 673e6), set("speak", true, 335e6, 100e6)];
  expect(offerWords(half)).toBe("Voice needs 235 MB of models, fetched once and kept on this computer: Speaking (235 MB).");
});
