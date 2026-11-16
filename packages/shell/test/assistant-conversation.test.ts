/**
 * The conversation with Dashi's assistant (agents/assistant/conversation.ts;
 * decisions.md D147): open until two minutes after Dashi's last word with
 * nothing said, on a clock a test moves; kept open while something is said
 * or done; ended by the person; and written down in words.
 */

import { expect, test } from "bun:test";
import { contextBlock, exchangesWords, type Moment, timeWords } from "../src/agents/assistant/context.ts";
import { Conversation, TALK_OPEN_MS } from "../src/agents/assistant/conversation.ts";
import { handTimers } from "./support/voice.ts";

function conversation() {
  const timers = handTimers();
  const lines: Array<Record<string, unknown>> = [];
  const closed: string[] = [];
  let id = 0;
  const talk = new Conversation({
    timers,
    now: () => 5_000,
    log: { add: (line) => lines.push(line) },
    newId: () => `talk${++id}`,
    closed: (which, why) => closed.push(`${which}:${why}`),
  });
  return { talk, timers, lines, closed };
}

test("it stays open until two minutes after Dashi's last word, and the next thing said then starts a new one", () => {
  const { talk, timers, closed } = conversation();
  expect(TALK_OPEN_MS).toBe(120_000);
  expect(talk.begin()).toEqual({ id: "talk1", fresh: true });
  talk.session = "session-1";
  // While Dashi works or speaks, no clock runs.
  timers.advance(600_000);
  expect(talk.open()).toBe(true);
  talk.rested();
  timers.advance(119_999);
  expect(talk.begin()).toEqual({ id: "talk1", fresh: false });
  expect(talk.session).toBe("session-1");
  talk.rested();
  timers.advance(119_999);
  expect(talk.open()).toBe(true);
  timers.advance(1);
  expect(talk.open()).toBe(false);
  expect(closed).toEqual(["talk1:quiet"]);
  expect(talk.begin()).toEqual({ id: "talk2", fresh: true });
  expect(talk.session).toBeNull();
});

test("the person, ❖Esc and the lock end it at once; its listeners hear it open and close", () => {
  const { talk, lines, closed } = conversation();
  let told = 0;
  talk.subscribe(() => told++);
  talk.begin();
  talk.record("talk1", { time: 9_000, asked: "open Helium", said: "Helium is open.", steps: ["Opening Helium"] });
  talk.end("stopped");
  talk.end("locked");
  // What ❖Esc stopped is written down too, though the conversation closed first.
  talk.record("talk1", { time: 9_500, asked: "count my windows", said: "", steps: ["Looking at your windows"], interrupted: true });
  expect(closed).toEqual(["talk1:stopped"]);
  expect(told).toBe(2);
  expect(lines).toEqual([
    { conversation: "talk1", time: 9, asked: "open Helium", said: "Helium is open.", steps: ["Opening Helium"] },
    { conversation: "talk1", time: 5, closed: "stopped", exchanges: 1 },
    { conversation: "talk1", time: 9, asked: "count my windows", said: "", steps: ["Looking at your windows"], interrupted: true },
  ]);
  expect(talk.exchanges).toHaveLength(1);
});

const MOMENT: Moment = {
  window: { app: "Helium", title: "Bodytech | Mi cuenta", url: "https://www.bodytech.com.co/cuenta" },
  selection: "Plan Black",
  time: new Date(2026, 10, 15, 21, 49),
  language: "en_US",
  desktop: { index: 2, of: 3, windows: 4 },
  apps: ["Calendar", "Helium", "Notes", "Steam"],
  names: ["Bodytech", "Claude Code"],
  talk: "Answer in up to four short plain sentences.",
  about: "Call me Pe.",
};

test("the context block: what is in front, the page, the selection, the time, the Desktop, the apps and the names a transcript mishears", () => {
  expect(timeWords(MOMENT.time)).toBe("Sunday 15 November 2026, 21:49");
  const block = contextBlock(MOMENT, { fresh: true });
  expect(block.split("\n")).toEqual([
    "(Not said by the person, from Dashi:",
    "In front: Helium, “Bodytech | Mi cuenta”, showing https://www.bodytech.com.co/cuenta.",
    "Desktop 2 of 3 shows, with 4 windows.",
    "Selected text: “Plan Black”",
    "Now: Sunday 15 November 2026, 21:49. Session language: en_US.",
    "Apps installed: Calendar, Helium, Notes, Steam.",
    "What the person had you remember:",
    "Call me Pe.",
    "Their words are a transcript of speech and may be wrong; names of apps and sites may be misheard. The person uses: Bodytech, Claude Code.",
    "Answer in up to four short plain sentences.)",
  ]);
  expect(block.length).toBeLessThan(700);
});

test("inside an open conversation the block is short; a session that never heard it is told the last exchanges", () => {
  const later = contextBlock(MOMENT, { fresh: false });
  expect(later).not.toContain("Apps installed");
  expect(later).not.toContain("Call me Pe");
  expect(later).toContain("In front: Helium");
  const earlier = [
    { time: 1, asked: "open Helium and go to YouTube", said: "YouTube is open.", steps: ["Opening youtube.com"] },
    { time: 2, asked: "search for lo-fi", said: "", steps: [], interrupted: true as const },
  ];
  expect(exchangesWords(earlier)).toEqual([
    "- They said: “open Helium and go to YouTube”",
    "  You said: “YouTube is open.” (you did: Opening youtube.com)",
    "- They said: “search for lo-fi”",
    "  You said: “(nothing)” (interrupted by them)",
  ]);
  expect(contextBlock({ ...MOMENT, window: null, desktop: null, selection: null }, { fresh: true, earlier })).toContain("Earlier in this conversation:");
});
