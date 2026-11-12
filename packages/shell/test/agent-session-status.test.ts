import { expect, test } from "bun:test";
import { SessionStatus } from "../src/agents/lib/session/session-status.ts";
import { SETTLE_MS } from "../src/agents/lib/session/session-watch.ts";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();

test("an action's words stay a moment, then the pill says Idle", async () => {
  let published = 0;
  const status = new SessionStatus(
    () => published++,
    () => false,
  );
  expect(status.text).toBe("Connected");
  status.set("Clicking in Files");
  status.settle();
  await clock.advance(SETTLE_MS - 1);
  expect(status.text).toBe("Clicking in Files");
  await clock.advance(1);
  expect(status.text).toBe("Idle");
  expect(published).toBe(2);
});

test("newer words, a sheet asking or a closed connection keep the words as they are", async () => {
  let keeps = false;
  const status = new SessionStatus(
    () => {},
    () => keeps,
  );
  status.set("Typing");
  status.settle();
  status.set("Scrolling");
  await clock.advance(SETTLE_MS);
  expect(status.text).toBe("Scrolling");
  status.settle();
  keeps = true;
  await clock.advance(SETTLE_MS);
  expect(status.text).toBe("Scrolling");
  status.reset();
  expect(status.text).toBe("Connected");
});
