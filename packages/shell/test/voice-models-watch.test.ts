/** Settings › Voice sees models that appear while it is open (voice/models.ts `watch`). */

import { expect, test } from "bun:test";
import { VoiceModels } from "../src/voice/models.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";
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

fakeClockEachTest();

test("while Settings › Voice is open, models that appear in the folder behind its back are seen: one look after a burst of changes", async () => {
  const { state, voice } = models({ listen: 0, speak: 0 });
  const watching: { folder: string; changed: () => void; stopped: boolean }[] = [];
  const store = new VoiceModels(voice.service, (folder, changed) => {
    const entry = { folder, changed, stopped: false };
    watching.push(entry);
    return () => {
      entry.stopped = true;
    };
  });
  // A store given nothing to watch with watches nothing (a test's, a preview's).
  expect(models({ listen: 0, speak: 0 }).store.watch()).toBeInstanceOf(Function);
  const stop = store.watch();
  // Nothing to watch until the service said where the models are.
  expect(watching).toEqual([]);
  await store.refresh();
  expect(watching.map((each) => each.folder)).toEqual(["/home/alexk/.local/share/dashi/voice"]);
  expect(store.ready).toBe(false);
  // The models are copied in by hand: many changes, one look once they stop.
  state.listen = 600;
  state.speak = 400;
  const asked = voice.calls.length;
  for (let at = 0; at < 5; at++) watching[0]?.changed();
  expect(voice.calls.length).toBe(asked);
  await settle(450);
  expect(voice.calls.slice(asked)).toEqual(["models", "voices"]);
  expect(store.ready).toBe(true);
  // The same folder is watched once, however often the sets are read; the pane closing stops it.
  expect(watching.length).toBe(1);
  stop();
  expect(watching[0]?.stopped).toBe(true);
  // A change heard after that asks nothing.
  watching[0]?.changed();
  await settle(450);
  expect(voice.calls.slice(asked)).toEqual(["models", "voices"]);
});
