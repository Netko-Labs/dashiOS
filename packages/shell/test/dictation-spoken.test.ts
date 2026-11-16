/** Addresses, file names and numbers said aloud (src/dictation/lib/rules-spoken.ts). */

import { expect, test } from "bun:test";
import { applySpoken } from "../src/dictation/lib/rules-spoken.ts";

const say = (text: string): string => applySpoken(text).text;

test("an email, a web address and a file's name are written as they are", () => {
  expect(say("send it to alex at example dot com today")).toBe("send it to alex@example.com today");
  expect(say("Alex dot Kim at example dot co dot uk")).toBe("alex.kim@example.co.uk");
  expect(say("go to example dot com slash docs slash intro.")).toBe("go to example.com/docs/intro.");
  expect(say("open index dot ts and README dot md")).toBe("open index.ts and README.md");
  // Talking about them is not writing one.
  expect(say("the dot com bubble")).toBe("the dot com bubble");
  expect(say("look at example one")).toBe("look at example one");
});

test("numbers from ten up become digits; small ones, and what may start a list, stay words", () => {
  expect(say("I have twenty five things")).toBe("I have 25 things");
  expect(say("one hundred and twenty people")).toBe("120 people");
  expect(say("three thousand four hundred")).toBe("3400");
  expect(say("in twenty twenty six")).toBe("in 2026");
  // A time said as two numbers stays words: "nine 30" is nobody's way of writing it.
  expect(say("the standup is at nine thirty")).toBe("the standup is at nine thirty");
  expect(say("at ten forty five")).toBe("at ten forty five");
  expect(say("twenty one thirty")).toBe("21 30");
  expect(say("ten percent of it")).toBe("10% of it");
  expect(say("tengo treinta y cinco y dos mil")).toBe("tengo 35 y 2000");
  expect(say("veinticinco por ciento")).toBe("25%");
  expect(say("one, two, three")).toBe("one, two, three");
  expect(say("first this, second that")).toBe("first this, second that");
  expect(say("five or six of them")).toBe("five or six of them");
  expect(say("one two three")).toBe("one two three");
  expect(say("a hundred times")).toBe("a hundred times");
});
