/** Settings › Voice's rows (lib/panes/voice.tsx): the switch, the models, the talk key, Dashi's voice, and more languages. The person's alone: no agent turns the microphone's feature on. */

import type { RowDef } from "../types.ts";

export const VOICE_ROWS = [
  {
    id: "voice/on",
    title: "Voice",
    name: "Talk to Dashi",
    detail: "Hold a key and talk to Dashi; it answers out loud. Nothing you say leaves this computer.",
    keywords: ["speech", "talk", "hold to talk", "microphone", "listen", "speak", "captions", "assistant"],
    kind: "switch",
  },
  {
    id: "voice/models",
    title: "Models",
    name: "Voice's models",
    keywords: ["download", "fetch", "remove", "parakeet", "kokoro", "disk space", "pause", "resume"],
    kind: "value",
  },
  {
    id: "voice/key",
    title: "Talk key",
    detail: "Hold it to talk, let go to hear the answer.",
    keywords: ["copilot key", "right command", "hold to talk", "push to talk", "shortcut", "caps lock", "menu key"],
    kind: "choice",
  },
  {
    id: "voice/dashis-voice",
    title: "Dashi's voice",
    detail: "The voice answers and questions are said in.",
    keywords: ["speaker", "accent", "sample", "text to speech", "tts", "play", "language"],
    kind: "choice",
  },
  {
    id: "voice/more-languages",
    title: "More languages",
    name: "Voice in more languages",
    keywords: ["whisper", "japanese", "chinese", "korean", "arabic", "hindi", "turkish", "language model", "download"],
    kind: "action",
  },
] as const satisfies readonly RowDef[];
