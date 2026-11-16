/**
 * The gate and the model's seat (src/dictation/lib/gate.ts, rewrite.ts,
 * land.ts; docs/dictation-rewrite.md): the model is asked only where the
 * rules' text needs it, with the profile's tone, the vocabulary and the
 * text before the caret; only an answer that is text changes what lands;
 * with no model everything works by the rules alone.
 */

import { expect, test } from "bun:test";
import { wordsFrom } from "../src/dictation/index.ts";
import { type GateReason, gate } from "../src/dictation/lib/gate.ts";
import { languagesOf } from "../src/dictation/lib/language.ts";
import { keepAccents, placesChanged, wordsChanged } from "../src/dictation/lib/rewrite.ts";
import { OWN_TERMS } from "../src/dictation/lib/seed.ts";
import { tidy } from "../src/dictation/lib/tidy.ts";
import type { RewriteAdvice, RewriteReply, RewriteRequest, Rewriter, RewriteState } from "../src/rewrite/types.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

const WORDS = wordsFrom([
  "just\ngive\nme\nidea/S\nthe\nmeeting\nis\nat\nfive\nsix\nno\nI\nmean\nsee\nyou\nthere\nit\nwork/SDG\nwell\ncloud\ncan\ndo\nthat\nright\nnow\ncannot\nfirst\nsecond\nwe\nbuy\nmilk\nthen\ncook\nactually",
]);
const why = (text: string, over: { listed?: boolean; polish?: boolean } = {}): GateReason[] =>
  gate({ text, listed: over.listed ?? false, terms: OWN_TERMS, words: WORDS, polish: over.polish ?? false });

test("a short clean sentence is not the model's; a self-correction, a repeat, a run-on, a non-word and a near name are", () => {
  expect(why("See you there.")).toEqual([]);
  expect(why("The meeting is at five, no, I mean six.")).toEqual(["cue"]);
  expect(why("Nos vemos a las cinco, perdón, a las seis.")).toEqual(["cue"]);
  expect(why("Right now, it works. Right now it cannot do that.")).toEqual(["cue"]);
  expect(why("Just give me idead")).toEqual(["non-word"]);
  expect(why("Cloud can do that.")).toEqual(["near-term"]);
  expect(why("First we buy milk second we cook")).toEqual(["list"]);
  expect(why("First we buy milk second we cook", { listed: true })).toEqual([]);
  expect(why(Array.from({ length: 26 }, () => "well").join(" x "))).toContain("run-on");
  expect(why("See you there.", { polish: true })).toEqual(["polish"]);
  // What the model was scored on, in Spanish and mixed (docs/dictation-rewrite.md): each is a reason to ask it.
  for (const said of [
    "Reserva una mesa para cuatro, digo para cinco personas.",
    "Tenemos tres opciones, no, cuatro opciones.",
    "El paquete llega mañana, o sea, no, pasado mañana.",
    "Vamos a usar Postgres, mejor dicho SQLite.",
    "Le dije a las ocho, quise decir a las nueve.",
    "Llego en diez minutos, espera, en veinte.",
    "Le dije que viniera a las ocho, miento, a las nueve.",
    "Call me a las tres, no, a las cuatro.",
    "We need el presupuesto by Friday, digo, by Thursday.",
    "Put the button a la izquierda, I mean a la derecha.",
    "I think it's Tuesday. No, it's Wednesday today.",
    "Book the room for an hour actually for two hours.",
    "She lives in Portland Oregon sorry Portland Maine.",
    // As the recogniser writes Spanish: no comma after the "no".
    "Tenemos tres opciones, no cuatro opciones.",
    "Llámame a las tres, no a las cuatro.",
    "Nos vemos a las cinco, no digo a las seis.",
    "El paquete llega mañana, o sea, no pasado mañana.",
  ])
    expect(why(said)).toContain("cue");
  // A cue that opens what was said takes nothing back, and "te digo" is not "I mean".
  expect(why("No, I mean it.")).not.toContain("cue");
  expect(why("No, gracias, ya he comido.")).not.toContain("cue");
  expect(why("Sorry, I am late.")).not.toContain("cue");
  expect(why("Hey, but no.")).not.toContain("cue");
  expect(why("Te digo que no voy.")).not.toContain("cue");
  expect(why("No sé si viene, no creo que pueda.")).not.toContain("cue");
  expect(why("I asked him, no answer yet.")).not.toContain("cue");
  // A real "no" and an "actually" inside a sentence are not corrections.
  expect(why("No, I see you there.")).toEqual([]);
  expect(why("I actually see you there.")).toEqual([]);
});

test("the model's answer keeps the speaker's accents; a change of mind inside quotation marks is not carried out", () => {
  expect(keepAccents("Pues, mándame el, el archivo cuando puedas.", "Pues, mandame el archivo cuando puedas.")).toBe("Pues, mándame el archivo cuando puedas.");
  expect(keepAccents("Pues, mándame el archivo.", "Mandame el archivo.")).toBe("Mándame el archivo.");
  // A word the model really changed, and one said both ways, are left as it wrote them.
  expect(keepAccents("Si quieres, sí, a las cinco, no, seis.", "Si quieres, sí, a las seis.")).toBe("Si quieres, sí, a las seis.");
  expect(keepAccents("See you at five, no, six.", "See you at six.")).toBe("See you at six.");
  const quoted = 'The tool should understand phrases like "scratch that" and "actually".';
  expect(tidy(quoted).typed).toBe(quoted);
});

test("the language of what was said, with the text before it", () => {
  expect(languagesOf("the meeting is at five", "", undefined)).toEqual(["en"]);
  expect(languagesOf("nos vemos a las cinco, ¿está bien?", "", "en_US.UTF-8")).toEqual(["es"]);
  expect(languagesOf("nos vemos at five with the team y ya", "", undefined)).toEqual(["en", "es"]);
  expect(languagesOf("ok", "Hola, ¿cómo estás?", undefined)).toEqual(["es"]);
  expect(languagesOf("ok", "", "es_CO.UTF-8")).toEqual(["es"]);
  expect(wordsChanged("at five no I mean six", "at six")).toBe(4);
  // The capsule counts places, not words: one correction is one fix.
  expect(placesChanged("Let's meet at five, no, I mean six.", "Let's meet at six.")).toBe(1);
  expect(placesChanged("Send it to Ana on Monday, sorry, on Tuesday, at five, no, six.", "Send it to Ana on Tuesday, at six.")).toBe(2);
  expect(placesChanged("See you there.", "See you there.")).toBe(0);
  expect(placesChanged("I think it is fine", "It is fine")).toBe(1);
});

/** A rewriter a test scripts: what it answers, how it advises, and what it was asked. */
function scripted(reply: RewriteReply | Promise<RewriteReply>, over: { state?: RewriteState; advice?: RewriteAdvice } = {}) {
  const asked: RewriteRequest[] = [];
  const did = { warmed: 0 };
  const rewriter: Rewriter = {
    rewrite: async (request) => {
      asked.push(request);
      return reply;
    },
    warm: () => void did.warmed++,
    state: () => over.state ?? "ready",
    advice: () => over.advice ?? { land: "once", deadlineMs: 1200 },
  };
  return { rewriter, asked, did };
}

const timings = { totalMs: 400, firstTokenMs: 120, tokens: 9 };
const CUE = "The meeting is at five, no, I mean six.";

test("a self-correction goes to the model with the tone, the vocabulary and the text before; its answer lands, and Raw puts the heard words back", async () => {
  const { rewriter, asked, did } = scripted({ kind: "text", text: "The meeting is at six.", timings });
  const { hub, world, typed, hold, key, state } = dictating({ heard: CUE, rewriter });
  world.before = "Hi Alex. ";
  await hold();
  expect(did.warmed).toBe(1);
  await key("up");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ transcript: CUE, languages: ["en"], before: "Hi Alex. ", tone: "Clear written sentences.", deadlineMs: 1200 });
  expect(asked[0]?.vocabulary).toEqual(expect.arrayContaining(["Dashi", "Claude Code"]));
  expect(typed).toEqual(["7:The meeting is at six. "]);
  expect(state()).toMatchObject({ phase: "landed", typed: "The meeting is at six.", heard: CUE, line: "Typed. 1 fix.", undo: true, raw: true });
  hub.dictationCommands.send({ do: "raw" });
  await settle();
  expect(world.before).toBe(`Hi Alex. ${CUE} `);
});

test("a clean sentence is never sent, and with no model nothing is asked at all", async () => {
  const clean = scripted({ kind: "text", text: "Something else.", timings });
  const first = dictating({ heard: "See you there.", rewriter: clean.rewriter });
  await first.hold();
  await first.key("up");
  expect(clean.asked).toEqual([]);
  expect(first.typed).toEqual(["7:See you there. "]);

  for (const stateNow of ["no-model", "off", "too-slow"] as const) {
    const none = scripted({ kind: "text", text: "Wrong.", timings }, { state: stateNow });
    const second = dictating({ heard: CUE, rewriter: none.rewriter });
    await second.hold();
    await second.key("up");
    expect(none.asked).toEqual([]);
    expect(second.typed).toEqual([`7:${CUE} `]);
  }
  // No rewriter given at all: the rules alone.
  const bare = dictating({ heard: CUE });
  await bare.hold();
  await bare.key("up");
  expect(bare.typed).toEqual([`7:${CUE} `]);
});

test("unchanged, a failure or the deadline land the rules' words", async () => {
  const replies: RewriteReply[] = [
    { kind: "unchanged", timings },
    { kind: "failed", why: "deadline", detail: "1200 ms", timings },
    { kind: "failed", why: "refused", detail: "overlap", timings },
  ];
  for (const reply of replies) {
    const { rewriter, asked } = scripted(reply);
    const { typed, hold, key, state } = dictating({ heard: `Um, ${CUE}`, rewriter });
    await hold();
    await key("up");
    expect(asked[0]?.transcript).toBe(CUE);
    expect(typed).toEqual([`7:${CUE} `]);
    expect(state()).toMatchObject({ phase: "landed", line: "Typed. 1 filler out." });
  }
});

test("the capsule says Tidying only once the wait has lasted 300 ms", async () => {
  let answer: (reply: RewriteReply) => void = () => {};
  const { rewriter } = scripted(new Promise<RewriteReply>((resolve) => void (answer = resolve)));
  const { timers, typed, hold, key, state } = dictating({ heard: CUE, rewriter });
  await hold();
  await key("up");
  expect(state()).toMatchObject({ phase: "tidying" });
  expect(state()).not.toMatchObject({ said: true });
  timers.advance(300);
  expect(state()).toMatchObject({ phase: "tidying", said: true });
  answer({ kind: "text", text: "The meeting is at six.", timings });
  await settle();
  expect(typed).toEqual(["7:The meeting is at six. "]);
});

test("on a machine too slow to wait on, the rules' words land and the model's replace them if the field still ends with them", async () => {
  let answer: (reply: RewriteReply) => void = () => {};
  const pending = new Promise<RewriteReply>((resolve) => void (answer = resolve));
  const { rewriter, asked } = scripted(pending, { advice: { land: "refine", deadlineMs: 6000 } });
  const { world, hold, key, state } = dictating({ heard: CUE, rewriter });
  world.before = "";
  await hold();
  await key("up");
  expect(world.before).toBe(`${CUE} `);
  expect(asked[0]).toMatchObject({ deadlineMs: 6000 });
  answer({ kind: "text", text: "The meeting is at six.", timings });
  await settle();
  expect(world.before).toBe("The meeting is at six. ");
  expect(state()).toMatchObject({ phase: "landed", line: "Typed. Refined.", raw: true });

  // The person typed on: the model's words are dropped.
  let late: (reply: RewriteReply) => void = () => {};
  const slow = scripted(new Promise<RewriteReply>((resolve) => void (late = resolve)), { advice: { land: "refine", deadlineMs: 6000 } });
  const second = dictating({ heard: CUE, rewriter: slow.rewriter });
  second.world.before = "";
  await second.hold();
  await second.key("up");
  second.world.before += "and more";
  late({ kind: "text", text: "The meeting is at six.", timings });
  await settle();
  expect(second.world.before).toBe(`${CUE} and more`);
});
