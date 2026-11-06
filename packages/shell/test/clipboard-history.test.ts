import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipboardHistory, type ClipEntry, MAX_AGE_MS, parseEntry, prune } from "../src/clipboard/history.ts";
import { age, entryTitle, historySections, oneLine, skippedSummary } from "../src/clipboard/rows.ts";
import { forAgent } from "../src/clipboard/start.ts";

// The history: 200 copies or 7 days, pinned ones kept, a copy already there
// moved to the top, kept in 0600 files on this computer only.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function history(clock: { now: number }): ClipboardHistory {
  const dir = mkdtempSync(join(tmpdir(), "dashi-clipboard-"));
  dirs.push(dir);
  return new ClipboardHistory({ dir: join(dir, "clipboard"), now: () => clock.now, sync: true });
}

const text = (value: string, app = "Notes") => ({ kind: "text" as const, mime: "text/plain;charset=utf-8", text: value, app });

test("copies go on top; one copied again moves up instead of being kept twice", () => {
  const clock = { now: 1_000_000 };
  const kept = history(clock);
  kept.add(text("first"));
  clock.now += 1000;
  kept.add(text("second", "Terminal"));
  clock.now += 1000;
  const again = kept.add(text("first", "Mail"));
  expect(kept.getSnapshot().entries.map((entry) => entry.text)).toEqual(["first", "second"]);
  expect(again?.app).toBe("Mail");
  expect(again?.copiedAt).toBe(clock.now);
});

test("at most 200 copies and none older than 7 days, but pinned ones stay", () => {
  const entry = (id: number, copiedAt: number, pinned = false): ClipEntry => ({
    id: id.toString(16).padStart(32, "0"),
    kind: "text",
    mime: "text/plain",
    text: String(id),
    app: null,
    copiedAt,
    ...(pinned ? { pinned: true as const } : {}),
  });
  const now = 10 * MAX_AGE_MS;
  const old = [entry(1, now - MAX_AGE_MS - 1), entry(2, now - MAX_AGE_MS - 1, true), entry(3, now)];
  expect(prune(old, now).map((each) => each.text)).toEqual(["2", "3"]);
  const many = Array.from({ length: 205 }, (_, at) => entry(at + 1, now - at, at === 204));
  const left = prune(many, now);
  expect(left.length).toBe(200);
  // The oldest unpinned went; the pinned one at the very end stayed.
  expect(left.at(-1)?.text).toBe("205");
  expect(left.at(-2)?.text).toBe("199");
});

test("pin, delete and clear; the file is 0600 in a 0700 folder and read back as it was", () => {
  const clock = { now: 5_000_000 };
  const kept = history(clock);
  const a = kept.add(text("Calle de la Luna 12, 2º B")) as ClipEntry;
  kept.add(text("git push origin release/0.4.0", "Terminal"));
  kept.pin(a.id, true);
  const again = new ClipboardHistory({ dir: kept.dir, now: () => clock.now, sync: true });
  expect(again.getSnapshot().entries.map((entry) => [entry.text, entry.pinned ?? false])).toEqual([
    ["git push origin release/0.4.0", false],
    ["Calle de la Luna 12, 2º B", true],
  ]);
  expect(statSync(join(kept.dir, "history.json")).mode & 0o777).toBe(0o600);
  expect(statSync(kept.dir).mode & 0o777).toBe(0o700);
  kept.delete(a.id);
  expect(kept.getSnapshot().entries.length).toBe(1);
  kept.skipped("password field", "Firefox");
  kept.clear();
  expect(kept.getSnapshot()).toEqual({ entries: [], skipped: [] });
});

test("a picture is kept beside the file, and goes with its entry", () => {
  const clock = { now: 1 };
  const kept = history(clock);
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const entry = kept.add({ kind: "image", mime: "image/png", app: "Screenshot", imageBytes: bytes }) as ClipEntry;
  const path = kept.imagePath(entry) as string;
  expect(path.endsWith(".png")).toBe(true);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  kept.delete(entry.id);
  expect(existsSync(path)).toBe(false);
  expect(readdirSync(kept.imagesDir)).toEqual([]);
  // Too large: not kept at all.
  expect(kept.add({ kind: "image", mime: "image/png", app: null, imageBytes: new Uint8Array(10 * 1024 * 1024 + 1) })).toBeNull();
});

test("a file edited by hand keeps only well-formed entries", () => {
  expect(parseEntry({ id: "../../etc", kind: "text", mime: "text/plain", text: "x", copiedAt: 1 })).toBeNull();
  expect(parseEntry({ id: "a".repeat(32), kind: "image", mime: "image/png", image: "../x.png", copiedAt: 1 })).toBeNull();
  expect(parseEntry({ id: "a".repeat(32), kind: "text", mime: "text/plain", text: "x", app: 3, copiedAt: 1 })).toEqual({
    id: "a".repeat(32),
    kind: "text",
    mime: "text/plain",
    text: "x",
    app: null,
    copiedAt: 1,
  });
  const dir = mkdtempSync(join(tmpdir(), "dashi-clipboard-"));
  dirs.push(dir);
  writeFileSync(join(dir, "history.json"), "not json");
  expect(new ClipboardHistory({ dir, sync: true }).getSnapshot().entries).toEqual([]);
});

test("rows: pinned first, one line each, the age at the right, and the head says what was not kept", () => {
  const now = 100 * 60_000;
  const snapshot = {
    entries: [
      { id: "1".repeat(32), kind: "text" as const, mime: "text/plain", text: "git push\norigin", app: "Terminal", copiedAt: now - 2 * 60_000 },
      {
        id: "2".repeat(32),
        kind: "image" as const,
        mime: "image/png",
        image: `${"2".repeat(32)}.png`,
        size: { width: 1646, height: 937 },
        app: null,
        copiedAt: now - 8 * 60_000,
      },
      { id: "3".repeat(32), kind: "text" as const, mime: "text/plain", text: "Calle de la Luna 12, 2º B", app: null, copiedAt: 0, pinned: true as const },
    ],
    skipped: [
      { reason: "password field" as const, app: "Firefox", at: now },
      { reason: "left out" as const, app: "KeePassXC", at: now },
    ],
  };
  const [section] = historySections(snapshot, "", { now, enabled: true, imagePath: (entry) => `/state/${entry.image}` });
  expect(section?.title).toBe("3 copies");
  expect(section?.aside).toBe("2 copies not kept: a password field, KeePassXC");
  expect(section?.window).toBe(8);
  expect(section?.rows.map((row) => [row.title, row.detail ?? "", row.kind])).toEqual([
    ["Calle de la Luna 12, 2º B", "", "Pinned"],
    ["git push origin", "Terminal", "2 min"],
    ["Image", "1646 × 937", "8 min"],
  ]);
  expect(section?.rows[2]?.icon).toEqual({ image: `/state/${"2".repeat(32)}.png` });
  // Searching: every word, accents folded; "image" finds pictures.
  expect(historySections(snapshot, "calle luna", { now, enabled: true, imagePath: () => null })[0]?.rows.map((row) => row.title)).toEqual([
    "Calle de la Luna 12, 2º B",
  ]);
  expect(historySections(snapshot, "image", { now, enabled: true, imagePath: () => null })[0]?.rows.map((row) => row.title)).toEqual(["Image"]);
  expect(historySections(snapshot, "zzz", { now, enabled: true, imagePath: () => null })[0]?.rows.map((row) => row.id)).toEqual(["clip:none"]);
  expect(historySections(snapshot, "", { now, enabled: false, imagePath: () => null })[0]?.rows.map((row) => row.id)).toEqual(["clip:off"]);
});

test("titles, ages and the summary read as a person says them", () => {
  expect(oneLine("  a\n\n b  c ")).toBe("a b c");
  expect(oneLine("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  expect(
    entryTitle({ id: "", kind: "files", mime: "text/uri-list", text: "file:///home/alexk/a%20b.txt\r\nfile:///home/alexk/c.png\r\n", app: null, copiedAt: 0 }),
  ).toBe("a b.txt and 1 more");
  expect(age(0, 30_000)).toBe("Now");
  expect(age(0, 3 * 3600_000)).toBe("3 h");
  expect(age(0, 30 * 3600_000)).toBe("Yesterday");
  expect(age(0, 80 * 3600_000)).toBe("3 days");
  expect(skippedSummary([])).toBeNull();
  expect(skippedSummary([{ reason: "secret", app: null, at: 0 }])).toBe("1 copy not kept: marked secret");
});

test("what an agent reads of a copy: text cut short, what a picture or files were", () => {
  expect(forAgent({ id: "", kind: "image", mime: "image/png", image: "x.png", size: { width: 2, height: 3 }, app: "Preview", copiedAt: 0 })).toEqual({
    kind: "image",
    text: "A picture, 2 × 3",
    app: "Preview",
    copiedAt: "1970-01-01T00:00:00.000Z",
    pinned: false,
  });
  expect(forAgent({ id: "", kind: "files", mime: "text/uri-list", text: "file:///home/alexk/a%20b.txt\r\n", app: null, copiedAt: 0 }).text).toBe(
    "/home/alexk/a b.txt",
  );
  expect(forAgent({ id: "", kind: "text", mime: "text/plain", text: "x".repeat(5000), app: null, copiedAt: 0 }).text.length).toBe(4000);
});
