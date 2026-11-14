/**
 * Reading in the card (src/capsule/lib/voice-mode.ts): a long answer, and a
 * plan too long to answer at once. "Read it all" scrolls the card in place,
 * and a yes counts only once its end has been shown (decisions.md D82).
 */

import { expect, test } from "bun:test";
import { CARD_ARM_MS } from "../src/shared/pill/index.ts";
import { stage } from "./support/capsule.ts";
import { flush } from "./support/time.ts";

test("an answer too long for the line is read whole in the card; Read it all scrolls it in place", () => {
  const { voice, tasks, state, say, mode, advance } = stage();
  const id = say("What is new?");
  tasks.settle(id, [], "A long answer. ".repeat(12));
  voice.show(null);
  expect(state.card).toMatchObject({ what: { reading: { id, request: "What is new?" } } });
  // Fits the card: nothing to scroll to, so the press closes it.
  mode.cardAction("read");
  expect(state.card).toBeNull();
  tasks.settle(say("Tell me all of it."), [], "A much longer answer than that. ".repeat(40));
  voice.show(null);
  expect(state.card).toMatchObject({ from: 0 });
  advance(1000);
  mode.cardAction("read");
  expect(state.card?.from).toBeGreaterThan(0);
  // Scrolled, its buttons arm again.
  expect(state.card?.armsAt).toBeGreaterThanOrEqual(2000 + CARD_ARM_MS);
  mode.cardAction("close");
  expect(state.card).toBeNull();
  // It goes when the person talks to Dashi again, or after two minutes.
  tasks.settle(say("And what else?"), [], "Another long answer. ".repeat(10));
  voice.show(null);
  expect(state.card).not.toBeNull();
  voice.show({ kind: "listening", text: "", question: false });
  expect(state.card).toBeNull();
  tasks.settle(say("And then?"), [], "A third long answer. ".repeat(10));
  voice.show(null);
  expect(state.card).not.toBeNull();
  advance(120_000);
  expect(state.card).toBeNull();
  // A short answer is only said.
  const short = say("What time is it?");
  tasks.settle(short, [], "Half past eleven.");
  expect(state.card).toBeNull();
});

test("a long plan: no yes before its end has been shown, pressed or said; Read it all scrolls it and then yes runs it", async () => {
  const { hub, voice, tasks, state, say, advance } = stage({ pressed: () => true });
  const steps = Array.from({ length: 9 }, (_, index) => `Step ${index + 1}`);
  const id = say("Do nine things");
  tasks.settle(id, steps);
  voice.show(null);
  advance(CARD_ARM_MS);
  hub.voiceCommands.send({ do: "answer-permission", id, yes: true });
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("planned");
  expect(state.card).toMatchObject({ from: 0 });
  state.mode?.cardAction("read");
  expect(state.card).toMatchObject({ what: { ask: { id } }, from: 5 });
  // The press that scrolled it, pressed twice, is no yes.
  hub.voiceCommands.send({ do: "answer-permission", id, yes: true });
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("planned");
  advance(CARD_ARM_MS);
  hub.voiceCommands.send({ do: "answer-permission", id, yes: true });
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("running");
});
