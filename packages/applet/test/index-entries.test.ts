import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, parseIndex, readInstalled, scanInstalled, sign, verifyIndex } from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

// Throwaway keys, made for this run only.
const dashi = generateKeys();
const stranger = generateKeys();
const author = generateKeys();
const authorKey = author.publicKey.split("\n")[1] ?? "";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const entry = (manifest: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  manifest,
  authorKey,
  source: { url: "https://github.com/x/y", commit: "abcdef0" },
  versions: [
    { version: String(manifest.version), dashi: ">=0.4", url: "https://x/y", sha256: "0".repeat(64), size: 1, signature: "x", released: "2026-11-04" },
  ],
  ...extra,
});

const weather = { ...ASUS, id: "dev.example.weather", name: "Weather", permissions: ["network"], when: undefined };
const clock = { ...ASUS, id: "dev.example.clock", name: "Clock", permissions: [], when: undefined };

test("an index with one entry this Dashi can't read lists the rest, and the bad one is skipped with its id and why", () => {
  const index = parseIndex({
    format: 1,
    generated: "2026-11-08T00:00:00Z",
    applets: [
      entry(weather),
      // A permission from a newer Dashi, and the kill switch's list beside it.
      entry(
        { ...ASUS, version: "0.3.0", permissions: ["hardware.power", "lights.everywhere"] },
        { pulled: [{ version: "0.1.0", reason: "drains the battery" }] },
      ),
      // A field this Dashi doesn't know, in the entry itself.
      entry(clock, { rating: 5 }),
      // Not even a manifest.
      "nonsense",
    ],
  });
  if ("error" in index) throw new Error(index.error);
  expect(index.applets.map((each) => each.manifest.id)).toEqual(["dev.example.weather"]);
  expect(index.skipped).toEqual([
    { id: ASUS.id, reason: expect.stringContaining("lights.everywhere"), pulled: [{ version: "0.1.0", reason: "drains the battery" }] },
    { id: "dev.example.clock", reason: expect.stringContaining("rating"), pulled: [] },
    { id: null, reason: expect.stringContaining("must be an object"), pulled: [] },
  ]);
});

test("an id listed twice is skipped both times; the index itself still has to be one", () => {
  const twice = parseIndex({ format: 1, generated: "x", applets: [entry(weather), entry(clock), entry({ ...weather, version: "0.2.0" })] });
  if ("error" in twice) throw new Error(twice.error);
  expect(twice.applets.map((each) => each.manifest.id)).toEqual(["dev.example.clock"]);
  expect(twice.skipped.map((each) => [each.id, each.reason])).toEqual([
    ["dev.example.weather", "the index lists dev.example.weather twice"],
    ["dev.example.weather", "the index lists dev.example.weather twice"],
  ]);
  // What isn't an index at all is still refused whole.
  expect(parseIndex({ format: 2, generated: "x", applets: [] })).toHaveProperty("error");
  expect(parseIndex({ format: 1, generated: "x", applets: "all of them" })).toHaveProperty("error");
  expect(parseIndex({ format: 1, generated: "x", applets: [], extra: true })).toHaveProperty("error");
});

test("a bad signature refuses everything, even the entries that read", () => {
  const indexBytes = bytes(JSON.stringify({ format: 1, generated: "x", applets: [entry(weather), entry({ ...clock, permissions: ["lights.everywhere"] })] }));
  const good = verifyIndex(indexBytes, sign(indexBytes, dashi.secretKey, "t"), dashi.publicKey);
  if ("error" in good) throw new Error(good.error);
  expect(good.applets).toHaveLength(1);
  expect(good.skipped).toHaveLength(1);
  expect(verifyIndex(indexBytes, sign(indexBytes, stranger.secretKey, "t"), dashi.publicKey)).toMatchObject({
    error: expect.stringContaining("isn't signed by its catalog's key"),
  });
  const changed = bytes(new TextDecoder().decode(indexBytes).replace("Weather", "Weathers"));
  expect(verifyIndex(changed, sign(indexBytes, dashi.secretKey, "t"), dashi.publicKey)).toHaveProperty("error");
});

test("an installed applet whose manifest no longer reads is listed apart, with its name and record, and never as one that runs", () => {
  const root = mkdtempSync(join(tmpdir(), "dashi-applets-unreadable-"));
  const put = (id: string, manifest: unknown, record: unknown): void => {
    mkdirSync(join(root, id));
    if (manifest !== undefined) writeFileSync(join(root, id, "applet.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    if (record !== undefined) writeFileSync(join(root, id, "install.json"), JSON.stringify(record));
  };
  const record = { version: "0.1.0", sha256: "0".repeat(64), authorKey, source: "catalog", consent: [] };
  put("dev.example.weather", weather, record);
  put(ASUS.id, { ...ASUS, permissions: ["lights.everywhere"] }, record);
  put("dev.example.clock", "{ not json", record);
  put("dev.example.moved", { ...clock, id: "dev.example.other" }, record);
  put("dev.example.stray", undefined, undefined);
  put("Not An Id", weather, record);
  const scan = scanInstalled(root);
  expect(scan.applets.map((each) => each.manifest.id)).toEqual(["dev.example.weather"]);
  expect(scan.unreadable.map(({ id, name, record: kept, reason }) => ({ id, name, version: kept?.version, reason }))).toEqual([
    { id: "dev.example.clock", name: null, version: "0.1.0", reason: "applet.json is not JSON" },
    { id: "dev.example.moved", name: "Clock", version: "0.1.0", reason: "applet.json says it is dev.example.other" },
    { id: ASUS.id, name: "ASUS Control", version: "0.1.0", reason: expect.stringContaining("lights.everywhere") },
  ]);
  expect(readInstalled(root)).toEqual(scan.applets);
  expect(scanInstalled(join(root, "nowhere"))).toEqual({ applets: [], unreadable: [] });
});
