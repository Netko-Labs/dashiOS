/** Learning from a fix (src/dictation/lib/learn.ts, landings.ts): one word changed after the landing is offered, and yes makes it a replacement. */

import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lexicon } from "../src/dictation/index.ts";
import { correctionOf, offerLine } from "../src/dictation/lib/learn.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

test("one fix with Dashi's words still round it is a correction; anything else is not", () => {
  expect(correctionOf("I use cursor code every day.", "Notes: I use Claude Code every day. ")).toEqual({ from: "cursor code", to: "Claude Code" });
  expect(correctionOf("Ask the dashy agent.", "Ask the Dashi agent. ")).toEqual({ from: "dashy", to: "Dashi" });
  expect(correctionOf("We meet at noon.", "We meet at noon. ")).toBeNull();
  // Rewritten, not fixed; or the text is gone.
  expect(correctionOf("We meet at noon.", "Let us talk tomorrow instead. ")).toBeNull();
  expect(correctionOf("We meet at noon.", "")).toBeNull();
  // Numbers, paths and addresses are never learned.
  expect(correctionOf("Call me at five today.", "Call me at 5 today. ")).toBeNull();
  expect(correctionOf("Open the main file now.", "Open the src/main.ts file now. ")).toBeNull();
  expect(offerLine({ from: "dashy", to: "Dashi" })).toBe("Always write “Dashi” for “dashy”?");
  expect(offerLine({ from: "siri", to: "Siri" })).toBe("Always write “Siri”?");
});

function learning(heard: string) {
  const lexicon = new Lexicon({ dir: join(mkdtempSync(join(tmpdir(), "dashi-learn-")), "dictation") });
  const all = dictating({ heard, lexicon });
  all.world.before = "";
  return { ...all, lexicon };
}

test("a word fixed within seconds of the landing is offered, and a tap of the dictation key says yes", async () => {
  const { world, timers, lexicon, hold, key, state } = learning("Ask the Koji agent about it.");
  await hold();
  await key("up");
  expect(world.before).toBe("Ask the Koji agent about it. ");
  // The person fixes the name by hand.
  world.before = "Ask the Kōji agent about it. ";
  timers.advance(2500);
  await settle();
  expect(state()).toMatchObject({ phase: "offer", from: "Koji", to: "Kōji", line: "Always write “Kōji” for “Koji”?" });
  await key("down");
  await key("tap");
  expect(state()).toMatchObject({ phase: "told", tone: "ok", line: "Saved. “Kōji” from now on." });
  expect(lexicon.getSnapshot().replacements).toContainEqual({ from: "Koji", to: "Kōji" });
  // And the next time it is written that way.
  await hold();
  await key("up");
  expect(world.before.endsWith("Ask the Kōji agent about it. ")).toBe(true);
});

test("nothing is offered when nothing was fixed, and an offer goes away by itself", async () => {
  const quiet = learning("See you there tomorrow.");
  await quiet.hold();
  await quiet.key("up");
  quiet.timers.advance(8000);
  await settle();
  expect(quiet.state().phase).toBe("idle");

  const offered = learning("See you there tomorrow.");
  await offered.hold();
  await offered.key("up");
  offered.world.before = "See you here tomorrow. ";
  offered.timers.advance(2500);
  await settle();
  expect(offered.state()).toMatchObject({ phase: "offer", from: "there", to: "here" });
  offered.hub.dictationCommands.send({ do: "dismiss" });
  expect(offered.state().phase).toBe("idle");
  expect(offered.lexicon.getSnapshot().replacements).toHaveLength(1);
});
