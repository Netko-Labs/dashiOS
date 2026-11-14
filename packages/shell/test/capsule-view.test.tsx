/** What the capsule's surface draws (src/capsule/lib/view.tsx): each state's line, the card with its limit, and the seat. */

import { expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { CAPSULE } from "../src/capsule/lib/measures.ts";
import { CapsuleView, type ViewState } from "../src/capsule/lib/view.tsx";
import type { OpenCard, Place, Shown } from "../src/capsule/types.ts";
import { cell, DEFAULT_PERSONA, type DictationState, type Persona, type PillAsk, type VoiceModeState } from "../src/shared/pill/index.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) if (isNode(child)) walk(child, visit);
}

/** Every text of the tree, in order, and its nodes by id. */
function read(tree: Node): { words: string[]; nodes: Map<string, Node> } {
  const words: string[] = [];
  const nodes = new Map<string, Node>();
  walk(tree, (node) => {
    if (node.type === "text") words.push((node.children ?? []).join(""));
    if (typeof node.props.id === "string") nodes.set(node.props.id, node);
  });
  return { words, nodes };
}

const HOME: Place = { seat: "home", bottom: 80, at: { centre: true }, maxWidth: CAPSULE.maxWidth, tail: CAPSULE.tail };

async function drawn(shown: Shown, options: { place?: Place; persona?: Persona; still?: boolean } = {}) {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const sent: unknown[] = [];
  const root = render(
    <CapsuleView
      state={cell<ViewState>({ shown, place: options.place ?? HOME, cardBottom: 63 })}
      level={cell(0.5)}
      persona={cell(options.persona ?? DEFAULT_PERSONA)}
      still={() => options.still ?? false}
      talkKey={() => "the Dashi key"}
      now={() => 10_000}
      onDictation={(command) => void sent.push(command)}
      onVoice={(command) => void sent.push(command)}
      onCard={(answer) => void sent.push(answer)}
      onBounds={() => {}}
    />,
    transport,
  );
  await settle();
  const { words, nodes } = read(JSON.parse(trees.at(-1) ?? "{}") as Node);
  /** Whether a node with that testID is drawn, and the node. */
  const has = (testID: string): boolean => root.nodeId(testID) !== undefined;
  const node = (testID: string): Node | undefined => nodes.get(root.nodeId(testID) ?? "");
  return { words, has, node, root, sent };
}

const dictation = (state: Exclude<DictationState, { phase: "idle" }>): Shown => ({ kind: "dictation", state });
const voice = (state: Exclude<VoiceModeState, { phase: "idle" }>): Shown => ({ kind: "voice", state });
const card = (what: OpenCard["what"], more: Partial<OpenCard> = {}): Shown => ({
  kind: "card",
  card: { what, keyboard: false, armsAt: 0, hears: false, ...more },
  listening: null,
});
const permission = (steps: string[]): PillAsk => ({ kind: "permission", id: "t", task: "t", request: "Turn on Dark Mode", steps, spoken: true, since: 0 });

test("nothing shows while nothing happens", async () => {
  const { words, has, root } = await drawn({ kind: "none" });
  expect(words).toEqual([]);
  expect(has("capsule-none")).toBe(true);
  root.unmount();
});

test("dictation: dots only as the key goes down, never Listening before the microphone is open", async () => {
  for (const phase of ["key-down", "opening"] as const) {
    const { words, has, root } = await drawn(dictation({ phase }));
    expect(words).toEqual([]);
    expect(has(`capsule:dictation:${phase}`)).toBe(true);
    expect(has("capsule-dots")).toBe(true);
    root.unmount();
  }
});

test("dictation: the words as heard, the first-time line, Typed with what changed", async () => {
  const listening = { phase: "listening", handsFree: false, endsAt: null } as const;
  expect((await drawn(dictation({ ...listening, text: "", hint: null }))).words).toEqual(["Listening"]);
  expect((await drawn(dictation({ ...listening, text: "", hint: "Hold to dictate. Let go to type." }))).words).toEqual(["Hold to dictate. Let go to type."]);
  expect((await drawn(dictation({ ...listening, text: "the release notes", hint: null }))).words).toEqual(["the release notes"]);
  const landed = await drawn(
    dictation({ phase: "landed", typed: "a", heard: "um a", changes: [{ kind: "filler", count: 2 }], line: "Typed. 2 fillers out.", until: 0 }),
  );
  expect(landed.words).toEqual(["Typed", "2 fillers out"]);
});

test("dictation: words that were not typed wait with Copy and a way to close; hands-free has Done", async () => {
  const waiting = await drawn(
    dictation({ phase: "waiting", text: "hello", heard: "hello", reason: "no-field", line: "No field to type in. Your words wait here.", until: 0 }),
  );
  expect(waiting.words).toEqual(["No field to type in", "Your words wait here", "Copy"]);
  const copy = waiting.root.nodeId("capsule-button:Copy");
  const close = waiting.root.nodeId("capsule-close");
  expect(copy && close).toBeTruthy();
  const free = await drawn(dictation({ phase: "listening", text: "", handsFree: true, endsAt: null, hint: null }));
  expect(free.words).toEqual(["Hands-free", "Done"]);
  const muted = await drawn(dictation({ phase: "notice", trouble: "muted", line: "The microphone is muted.", until: 0 }));
  expect(muted.words).toEqual(["The microphone is muted."]);
});

test("Dashi: what it heard comes with Cancel and Type it instead, before anything runs", async () => {
  const heard = await drawn(voice({ phase: "heard", text: "turn on dark mode" }));
  expect(heard.words).toEqual(["turn on dark mode", "Type it instead", "Cancel"]);
  expect(heard.has("capsule-disc")).toBe(true);
  // Nothing heard: nothing to type.
  expect((await drawn(voice({ phase: "heard", text: "" }))).words).toEqual(["Thinking", "Cancel"]);
});

test("Dashi: the step with Stop, the answer as it is spoken, done", async () => {
  expect((await drawn(voice({ phase: "step", title: "Turn Dark Mode on", index: 0, of: 2, task: "t" }))).words).toEqual([
    "Turn Dark Mode on",
    "1 of 2",
    "Stop",
  ]);
  const words = ["It", "is", "half", "past", "eleven."];
  expect((await drawn(voice({ phase: "answer", words, at: 1, full: words.join(" ") }))).words).toEqual(["It is", "half past eleven.", "Stop"]);
  expect((await drawn(voice({ phase: "done", line: "Done: Turn Dark Mode on", until: 0 }))).words).toEqual(["Done: Turn Dark Mode on"]);
  expect((await drawn(voice({ phase: "stopped", until: 0 }))).words).toEqual(["Stopped"]);
  expect((await drawn(voice({ phase: "listening", text: "", answering: true }))).words).toEqual(["Listening for your answer"]);
});

test("a persona's mark and colour show on Dashi's capsule, never on dictation's", async () => {
  const miso: Persona = { ...DEFAULT_PERSONA, name: "Miso", colour: "#1f8a5b", mark: "dots" };
  const listening = await drawn(voice({ phase: "key-down" }), { persona: miso });
  expect(listening.has("capsule-disc")).toBe(false);
  expect(listening.node("capsule:voice:key-down")?.props.background).not.toBe(
    (await drawn(voice({ phase: "key-down" }))).node("capsule:voice:key-down")?.props.background,
  );
  const ink = await drawn(dictation({ phase: "key-down" }), { persona: miso });
  expect(ink.node("capsule:dictation:key-down")?.props.background).toBe(
    (await drawn(dictation({ phase: "key-down" }))).node("capsule:dictation:key-down")?.props.background,
  );
});

test("the card shows the whole plan, names its task, and has both buttons", async () => {
  const shown = await drawn(card({ ask: permission(["Turn Dark Mode on", "Open “Notes”"]) }));
  expect(shown.words).toEqual([
    "?",
    "Dashi asks",
    "“Turn on Dark Mode”",
    "Do these 2 things?",
    "1. Turn Dark Mode on",
    "2. Open “Notes”",
    "Press a button, or tap the Dashi key then Return. Or hold the Dashi key and say yes.",
    "No",
    "Yes, this once",
  ]);
  expect(shown.has("card:permission")).toBe(true);
  expect(shown.has("card-keys")).toBe(false);
});

test("past the limit the card has no Yes: only Read it all", async () => {
  const shown = await drawn(card({ ask: permission(Array.from({ length: 9 }, (_, index) => `Step ${index + 1}`)) }));
  expect(shown.words).toContain("… and 4 more steps");
  expect(shown.words).not.toContain("Yes, this once");
  expect(shown.words.slice(-3)).toEqual(["It is too long to answer here.", "No", "Read it all"]);
});

test("a card with the keyboard says so and hears keys; a question says how to answer; a long answer closes", async () => {
  const focused = await drawn(card({ ask: permission(["Lock the screen"]) }, { keyboard: true }));
  expect(focused.has("card-keys")).toBe(true);
  expect(focused.words).toContain("Return is yes, Esc is no. Any other key gives the keyboard back.");
  const question = await drawn(
    card({ ask: { kind: "question", id: "q", text: "Which branch?", choices: [], who: "Claude Code", about: "fix the test", since: 0 } }),
  );
  expect(question.words).toEqual(["?", "Claude Code asks", "“fix the test”", "Which branch?", "Hold the Dashi key and answer, or type it.", "Skip", "Type it"]);
  const reading = await drawn(card({ reading: { id: "r", request: "what is new", text: "Three things.\nThe assistant." } }));
  expect(reading.words).toEqual(["Dashi says", "“what is new”", "Three things.", "The assistant.", "Close"]);
  expect(reading.has("capsule-disc")).toBe(true);
});

test("the seat is where the place says: centred, or beside the Dock", async () => {
  const beside: Place = { seat: "right", bottom: 21, at: { left: 852 }, maxWidth: 350, tail: 180 };
  const shown = await drawn(
    dictation({
      phase: "listening",
      text: "the release notes are almost done and Alex is checking the screenshots",
      handsFree: false,
      endsAt: null,
      hint: null,
    }),
    { place: beside },
  );
  expect(shown.has("capsule-seat:right")).toBe(true);
  // Beside the Dock there is less room: the end of the words.
  expect(shown.words).toEqual(["…checking the screenshots"]);
  expect((await drawn(dictation({ phase: "key-down" }))).has("capsule-seat:home")).toBe(true);
});
