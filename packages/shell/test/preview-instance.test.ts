import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handToEmpty, listenWhileEmpty, parseHandoff } from "../apps/preview/lib/instance.ts";
import { AppMenuStore } from "../src/app-menus/store.ts";
import { parseClientMessage } from "../src/shared/app-menus/protocol.ts";

// Review 20, B5: a file opened while Preview has an empty window opens in that window, not a second one.

const dir = mkdtempSync(join(tmpdir(), "dashi-preview-instance-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("an empty window takes the next file opened, and a start finds none once it stops listening", async () => {
  const handoff = join(dir, "handoff");
  const taken: string[] = [];
  const stop = listenWhileEmpty((path) => taken.push(path) > 0, handoff);
  expect(await handToEmpty("/home/alexk/Pictures/trip/img1.jpg", handoff)).toBe(true);
  expect(taken).toEqual(["/home/alexk/Pictures/trip/img1.jpg"]);
  stop();
  expect(await handToEmpty("/home/alexk/b.png", handoff)).toBe(false);
});

test("the reply still arrives when taking the file stops the listener at once (review 22, B5)", async () => {
  const handoff = join(dir, "stops");
  let stop = (): void => {};
  // As Preview's window did: taking the file leaves the empty state, which stops listening there and then.
  stop = listenWhileEmpty(() => {
    stop();
    return true;
  }, handoff);
  expect(await handToEmpty("/home/alexk/Pictures/trip/img3.jpg", handoff)).toBe(true);
});

test("a window that has a file of its own by then says no, and the start opens its own window", async () => {
  const handoff = join(dir, "busy");
  const stop = listenWhileEmpty(() => false, handoff);
  expect(await handToEmpty("/home/alexk/a.png", handoff)).toBe(false);
  stop();
});

test("a socket left by a window that went is cleared, and nothing waits on it", async () => {
  const handoff = join(dir, "stale");
  const stop = listenWhileEmpty(() => true, handoff);
  // A crash leaves the file without a listener: here, a plain file in its place.
  const stale = join(handoff, "999999.sock");
  writeFileSync(stale, "");
  stop();
  expect(await handToEmpty("/home/alexk/a.png", handoff)).toBe(false);
  expect(existsSync(stale)).toBe(false);
  expect(await handToEmpty("/home/alexk/a.png", join(dir, "none"))).toBe(false);
});

test("only an absolute path is taken from a line", () => {
  expect(parseHandoff('{"open":"/home/alexk/a.png"}')).toBe("/home/alexk/a.png");
  expect(parseHandoff('{"open":"a.png"}')).toBeNull();
  expect(parseHandoff('{"open":"/a\\u0000b"}')).toBeNull();
  expect(parseHandoff("[]")).toBeNull();
  expect(parseHandoff("not json")).toBeNull();
});

test("the window that took it asks to come forward; the shell hears which process asked", () => {
  expect(parseClientMessage('{"type":"front"}')).toEqual({ type: "front" });
  expect("error" in parseClientMessage('{"type":"front","menus":[]}')).toBe(true);
  const store = new AppMenuStore();
  const heard: number[] = [];
  const stop = store.onFront((pid) => heard.push(pid));
  store.front({ pid: 42, send: () => {} });
  stop();
  store.front({ pid: 43, send: () => {} });
  expect(heard).toEqual([42]);
});
