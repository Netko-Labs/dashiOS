/** Settings › Voice's rows (lib/panes/voice.tsx): the switch, the models, the talk key, Dashi's voice, dictation, and more languages. The person's alone: no agent turns the microphone's feature on. */

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
    keywords: ["copilot key", "command space", "dashi key", "hold to talk", "push to talk", "shortcut", "caps lock", "menu key"],
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
    id: "voice/dictation",
    title: "Dictation",
    name: "Dictate into any text field",
    detail: "Hold the dictation key and talk; let go and your words are typed where the keyboard is. Nothing you say leaves this computer.",
    keywords: ["speech to text", "type by voice", "transcribe", "microphone", "talk to type", "write"],
    kind: "switch",
  },
  {
    id: "voice/dictation-key",
    title: "Dictation key",
    detail: "Hold it alone to dictate. Automatic is the right ⌥, or Caps Lock on a layout where the right ⌥ types accents.",
    keywords: ["right option", "alt gr", "caps lock", "right control", "menu key", "hold to dictate", "shortcut"],
    kind: "choice",
  },
  {
    id: "voice/hands-free",
    title: "Hands-free",
    name: "Hands-free dictation",
    detail: "Tap the dictation key twice to keep dictating without holding it. Each sentence is typed at its pause; a tap ends it.",
    keywords: ["double tap", "continuous", "keep listening", "dictate"],
    kind: "switch",
  },
  {
    id: "voice/tidy",
    title: "Tidy what I say",
    detail: "Leaves out “um” and “uh”, sets spaces and capitals, and types “comma” or “new line” as said. Off types the words as heard.",
    keywords: ["filler", "punctuation", "capitals", "clean up", "new line", "comma", "scratch that"],
    kind: "switch",
  },
  {
    id: "voice/more-languages",
    title: "More languages",
    name: "Voice in more languages",
    keywords: ["whisper", "japanese", "chinese", "korean", "arabic", "hindi", "turkish", "language model", "download"],
    kind: "action",
  },
] as const satisfies readonly RowDef[];
