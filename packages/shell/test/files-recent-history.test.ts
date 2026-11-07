import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecentlyUsed, withRecent } from "../apps/files/recent.ts";
import { readRecents, recordRecents } from "../apps/files/recent-file.ts";

const AT = new Date("2026-11-07T01:30:00Z");
const ICS = { path: "/home/alexk/Downloads/google & co.ics", mime: "text/calendar", app: "dev.dashi.calendar", exec: "'dev.dashi.calendar' %u" };

test("a file used goes into the history, escaped, and reads back", () => {
  const xml = withRecent(null, [ICS], AT);
  expect(xml).toContain('href="file:///home/alexk/Downloads/google%20&amp;%20co.ics"');
  expect(xml).toContain('<mime:mime-type type="text/calendar"/>');
  expect(parseRecentlyUsed(xml)).toEqual([{ path: ICS.path, time: AT.getTime() }]);
});

test("a file already there is used again, the rest of the history kept", () => {
  const gtk = withRecent(null, [{ ...ICS, path: "/home/alexk/notes.txt", mime: "text/plain" }, ICS], new Date("2026-11-01T00:00:00Z"));
  const again = withRecent(gtk, [ICS], AT);
  expect(parseRecentlyUsed(again)).toEqual([
    { path: ICS.path, time: AT.getTime() },
    { path: "/home/alexk/notes.txt", time: Date.parse("2026-11-01T00:00:00Z") },
  ]);
  expect(again.match(/<bookmark /g)?.length).toBe(2);
});

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-recent-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a pick in the chooser is in Recents next time", async () => {
  const env = { XDG_DATA_HOME: dir, XDG_DATA_DIRS: dir };
  expect(await readRecents(env)).toEqual([]);
  await recordRecents(["/home/alexk/Downloads/google.ics"], "dev.dashi.calendar", env);
  expect((await readRecents(env)).map((file) => file.path)).toEqual(["/home/alexk/Downloads/google.ics"]);
  // A history another desktop wrote is added to, not replaced.
  writeFileSync(join(dir, "recently-used.xbel"), withRecent(null, [{ ...ICS, path: "/home/alexk/a.txt" }], new Date("2026-01-01T00:00:00Z")));
  await recordRecents(["/home/alexk/b.txt"], "dev.dashi.editor", env);
  expect((await readRecents(env)).map((file) => file.path)).toEqual(["/home/alexk/b.txt", "/home/alexk/a.txt"]);
  expect(readFileSync(join(dir, "recently-used.xbel"), "utf8")).toContain('name="dev.dashi.editor"');
});
