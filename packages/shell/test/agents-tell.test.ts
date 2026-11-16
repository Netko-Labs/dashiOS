import { expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { notifyPerson, Teller, tellPerson } from "../src/agents/desktop/tell.ts";
import { parseCall } from "../src/agents/index.ts";

function voice(talking = false) {
  const said: string[] = [];
  return { said, voice: { say: (text: string) => void said.push(text), personTalking: () => talking, talkKey: () => "❖Space" } };
}

test("a line is said at most once every 4 s, never over the person, and the answer says why not", () => {
  let now = 0;
  const { said, voice: v } = voice();
  const teller = new Teller(v, () => now);
  expect(teller.tell("Still looking: one page read")).toEqual({ said: true });
  now = 1500;
  expect(teller.tell("Two pages")).toEqual({ said: false, why: "too soon", waitMs: 2500 });
  now = 4000;
  expect(teller.tell("Three pages")).toEqual({ said: true });
  expect(said).toEqual(["Still looking: one page read", "Three pages"]);
  const busy = new Teller(voice(true).voice, () => 0);
  expect(busy.tell("x")).toEqual({ said: false, why: "the person is talking" });
  expect(new Teller(null).tell("x")).toEqual({ said: false, why: "Voice is off" });
  // Voice that can't speak (off, or no models): shown only, not claimed said.
  expect(new Teller({ ...voice().voice, talkKey: () => null }, () => 0).tell("x")).toEqual({ said: false, why: "Voice is off" });
});

test("tell_person shows the line either way; notify_person posts one from Dashi", () => {
  const status: string[] = [];
  const posted: unknown[] = [];
  const ctx = {
    status: (line: string) => void status.push(line),
    desktop: {
      tell: { tell: () => ({ said: false, why: "too soon", waitMs: 1200 }) },
      notifications: {
        notify: (input: unknown) => {
          posted.push(input);
          return 7;
        },
      },
    },
  } as unknown as RunContext;
  expect(tellPerson("Still looking", ctx).content[0]).toEqual({ type: "text", text: "Shown, not said: too soon. Wait 2 s before the next line." });
  expect(status).toEqual(["Still looking"]);
  expect(notifyPerson("Prices checked", "The cheapest is $120.", ctx).structuredContent).toEqual({ notification: 7 });
  expect(posted[0]).toMatchObject({ appName: "Dashi", summary: "Prices checked", body: "The cheapest is $120." });
  expect(parseCall({ name: "tell_person", arguments: { text: "  two\nlines " } })).toEqual({ name: "tell_person", text: "two lines" });
  expect(parseCall({ name: "notify_person", arguments: { title: "x" } })).toMatchObject({ arguments: expect.any(String) });
});
