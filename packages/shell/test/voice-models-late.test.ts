/**
 * Voice's models copied in while the session runs (voice/start.ts): the
 * Dashi key reads the models once again before it says they are missing,
 * so it never says "Voice needs its models" over models that are there.
 */

import { expect, test } from "bun:test";
import { talkKey } from "../src/voice/keys.ts";
import { startVoice } from "../src/voice/start.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

const set = (id: string, have: number) => ({ id, name: id, about: "", credit: "", basic: true, bytes: 100, have, installed: have === 100 });

function started() {
  const state = { have: 0 };
  const voice = fakeVoice({
    models: () => ({ folder: "/home/alexk/.local/share/dashi/voice", fetching: false, sets: [set("listen", state.have), set("speak", state.have)] }),
    voices: { default: "af_heart", voices: [] },
    "listen.stop": { text: "", speech_ms: 0 },
  });
  const data = { voice: { on: true, key: talkKey(undefined).id } };
  const parts = startVoice({
    settings: { getSnapshot: () => ({ data }), subscribe: () => () => {} },
    hold: () => {},
    asker: { ask: async () => ({ say: "" }) },
    go: () => {},
    connect: async () => voice.link,
  });
  return { voice, state, parts };
}

test("models copied in after the session read them: the next hold of the key listens", async () => {
  const { voice, state, parts } = started();
  await settle();
  expect(parts.models.ready).toBe(false);
  state.have = 100;
  voice.calls.length = 0;
  parts.voice.hold();
  await settle();
  expect(voice.calls.slice(0, 2)).toEqual(["models", "voices"]);
  expect(voice.calls).toContain("listen");
  expect(parts.voice.getSnapshot()?.kind).toBe("listening");
  parts.close();
});

test("models still missing after one more read: it says so, and does not listen", async () => {
  const { voice, parts } = started();
  await settle();
  voice.calls.length = 0;
  parts.voice.hold();
  await settle();
  expect(voice.calls).toEqual(["models", "voices"]);
  expect(parts.voice.getSnapshot()).toMatchObject({ kind: "notice", text: "Voice needs its models. See Settings › Voice.", go: "voice" });
  parts.voice.release();
  parts.close();
});
