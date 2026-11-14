/** The fake's scenes (fake.ts): each state the capsule and the card draw, by name, and three that move. */

import { DEFAULT_PERSONA, type DictationState } from "../../shared/pill/index.ts";
import { type Scene, type Stage, script, wobble } from "./fake.ts";

const HEARD = "The release notes are almost done and um Alex is checking the screenshots this afternoon";
const ASK = "Turn on Dark Mode and open Notes";
const LONG_ANSWER =
  "Dashi 0.9 has three parts. The first is the assistant: you hold the Dashi key and talk, and it answers in the capsule at the bottom of the screen.\nThe second is the Software store, where apps are found, installed and updated.\nThe third is a tidy-up of what was already there, on a newer drawing library that makes windows open sooner.";

const dictation =
  (state: (stage: Stage) => DictationState): Scene =>
  (stage) =>
    stage.hub.dictation.set(state(stage));

const listening = (text: string, handsFree = false, hint: string | null = null): DictationState => ({
  phase: "listening",
  text,
  handsFree,
  endsAt: null,
  hint,
});

/** A spoken ask, as 0.8's loop tells it: the words heard, then the task they became. */
function spokenAsk(stage: Stage, request: string): string {
  stage.voice.show({ kind: "thinking", text: request });
  return stage.tasks.ask(request);
}

function speak(stage: Stage, sentence: string, everyMs: number): void {
  const words = sentence.split(" ");
  for (const at of words.keys()) stage.timers.set(() => stage.voice.show({ kind: "speaking", words, at, full: sentence }), at * everyMs);
  stage.timers.set(() => stage.voice.show(null), words.length * everyMs + 400);
}

export const SCENES: Readonly<Record<string, Scene>> = {
  idle: (stage) => {
    stage.hub.dictation.set({ phase: "idle" });
    // Talking again closes an answer being read.
    stage.voice.show({ kind: "listening", text: "", question: false });
    stage.voice.show(null);
    stage.tasks.clear();
    stage.hub.level.set(0);
  },
  "d-key": dictation(() => ({ phase: "key-down" })),
  "d-opening": dictation(() => ({ phase: "opening" })),
  "d-listen": dictation(() => listening("")),
  "d-first": dictation(() => listening("", false, "Hold to dictate. Let go to type.")),
  "d-words": dictation(() => listening(HEARD)),
  "d-handsfree": dictation(() => listening("Hands-free goes on until you tap the key", true)),
  "d-tidy": dictation(() => ({ phase: "tidying", text: HEARD })),
  "d-typed": dictation(({ now }) => ({
    phase: "landed",
    typed: HEARD.replace(" um", ""),
    heard: HEARD,
    changes: [{ kind: "filler", count: 1 }],
    line: "Typed. 1 filler out.",
    until: now() + 6000,
  })),
  "d-nofield": dictation(({ now }) => ({
    phase: "waiting",
    text: HEARD,
    heard: HEARD,
    reason: "no-field",
    line: "No field to type in. Your words wait here.",
    until: now() + 600_000,
  })),
  "d-left": dictation(({ now }) => ({
    phase: "waiting",
    text: HEARD,
    heard: HEARD,
    reason: "left-window",
    line: "You left the window. Your words wait here.",
    until: now() + 600_000,
  })),
  "d-muted": dictation(({ now }) => ({ phase: "notice", trouble: "muted", line: "The microphone is muted.", until: now() + 4000 })),
  "d-nomodel": dictation(({ now }) => ({
    phase: "notice",
    trouble: "no-model",
    line: "Dictation needs its speech model. See Settings › Voice.",
    until: now() + 4000,
  })),
  "d-nothing": dictation(({ now }) => ({ phase: "notice", trouble: "nothing-said", line: "Nothing was heard.", until: now() + 4000 })),
  "d-ended": dictation(({ now }) => ({ phase: "notice", trouble: "ended", line: "Hands-free ended.", until: now() + 4000 })),
  /** A whole dictation: the key, the microphone, the words as heard, tidying, typed, gone. */
  "d-run": (stage) => {
    const words = HEARD.split(" ");
    const set = (state: DictationState) => () => stage.hub.dictation.set(state);
    wobble(stage, 4200);
    script(stage, [
      [0, set({ phase: "key-down" })],
      [300, set({ phase: "opening" })],
      [600, set(listening(""))],
      ...[4, 8, 12, words.length].map((count, index) => [1400 + index * 800, set(listening(words.slice(0, count).join(" ")))] as const),
      [4200, set({ phase: "tidying", text: HEARD })],
      [4900, () => SCENES["d-typed"]?.(stage)],
      [8500, set({ phase: "idle" })],
    ]);
  },
  "v-key": (stage) => void stage.hub.keys.send({ key: "dashi", gesture: "down", at: stage.now() }),
  "v-listen": (stage) => stage.voice.show({ kind: "listening", text: "", question: false }),
  "v-words": (stage) => stage.voice.show({ kind: "listening", text: "Turn on Dark Mode and", question: false }),
  "v-heard": (stage) => void spokenAsk(stage, ASK),
  "v-answer": (stage) =>
    stage.voice.show({ kind: "speaking", words: "It is half past eleven on Friday night.".split(" "), at: 3, full: "It is half past eleven on Friday night." }),
  "v-notice": (stage) => stage.voice.show({ kind: "notice", text: "No agent answers yet. Choose one in Settings, under Agents.", go: "agents" }),
  /** A spoken plan: its card opens by itself. */
  "v-permission": (stage) => {
    const id = spokenAsk(stage, ASK);
    stage.tasks.settle(id, ["Turn Dark Mode on", "Open “Notes”"], "Sure.");
    stage.voice.show(null);
  },
  /** A plan past the card's limit: no Yes, only "Read it all". */
  "v-long": (stage) => {
    const id = spokenAsk(stage, "Set this computer up for the talk");
    stage.tasks.settle(
      id,
      [
        "Turn Dark Mode on",
        "Turn Do Not Disturb on",
        "Set the volume to 40%",
        "Open “Notes”",
        "Open “Terminal”",
        "Open “Files”",
        "Join the Wi-Fi network “Stage”",
        "Lock the screen",
      ],
      "",
    );
    stage.voice.show(null);
  },
  /** A typed plan: it waits for the bar, and no card opens by itself. */
  "v-typed": (stage) => stage.tasks.settle(stage.tasks.ask("Open Files"), ["Open “Files”"]),
  /** What the bar sends for a typed plan's capsule. */
  "v-open": (stage) => {
    const ask = stage.hub.asks.getSnapshot()[0];
    if (ask) stage.hub.voiceCommands.send({ do: "open-ask", id: ask.id });
  },
  /** An answer too long for the line: read whole in the card. */
  "v-reading": (stage) => {
    const id = spokenAsk(stage, "What is new in Dashi 0.9?");
    stage.tasks.settle(id, [], LONG_ANSWER);
    stage.voice.show(null);
  },
  /** An agent's question: it opens by itself, and is answered by voice or typed elsewhere. */
  "v-question": (stage) =>
    stage.question({
      who: "Claude Code",
      text: "Which branch should the fix go to?",
      spoken: "Claude Code asks: Which branch should the fix go to?",
      seconds: 120,
      about: "fix the failing store test",
    }),
  "say-answer": (stage) => void stage.voice.hear("The release branch."),
  /** A tap of the Dashi key: with a card up, it gives the card the keyboard. */
  tap: (stage) => void stage.hub.keys.send({ key: "dashi", gesture: "tap", at: stage.now() }),
  /** The Dashi key held and "yes" said, as the whole of what was said. */
  "say-yes": (stage) => void stage.voice.hear("Yes."),
  "say-no": (stage) => void stage.voice.hear("No"),
  /** A whole spoken task: the key, the words, what was heard, the plan's card, a spoken yes, its steps, done. */
  "v-run": (stage) => {
    let id = "";
    wobble(stage, 2600);
    script(stage, [
      [0, () => SCENES["v-key"]?.(stage)],
      [300, () => stage.voice.show({ kind: "listening", text: "", question: false })],
      [1200, () => stage.voice.show({ kind: "listening", text: "Turn on Dark Mode", question: false })],
      [2000, () => stage.voice.show({ kind: "listening", text: ASK, question: false })],
      [2600, () => void (id = spokenAsk(stage, ASK))],
      [4200, () => stage.tasks.settle(id, ["Turn Dark Mode on", "Open “Notes”"], "Sure.")],
      [4250, () => stage.voice.show(null)],
      [7000, () => void stage.voice.hear("Yes.")],
    ]);
  },
  /** A spoken answer, word by word. */
  "v-speak": (stage) => speak(stage, "It is half past eleven on Friday night, and the build is green.", 260),
  "persona-miso": (stage) => stage.hub.persona.set({ ...DEFAULT_PERSONA, name: "Miso", colour: "#1f8a5b", mark: "dots" }),
  "persona-dashi": (stage) => stage.hub.persona.set(DEFAULT_PERSONA),
};
