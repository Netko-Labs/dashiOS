import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smallThemedFile, symbolicFile, TrayIcons } from "../src/tray/lib/icon.ts";

const root = mkdtempSync(join(tmpdir(), "dashi-icons-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (path: string, text: string) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};
put(
  "Adwaita/symbolic/status/audio-volume-high-symbolic.svg",
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>',
);
put("AdwaitaLegacy/22x22/legacy/network-idle.png", "png");

test("a status icon a theme keeps only as symbolic is found, and drawn as a glyph in the bar's ink", () => {
  expect(symbolicFile("audio-volume-high", "", [root])).toBe(join(root, "Adwaita/symbolic/status/audio-volume-high-symbolic.svg"));
  expect(symbolicFile("audio-volume-high-symbolic", "", [root])).not.toBeNull();
  expect(symbolicFile("../escape", "", [root])).toBeNull();
  const icon = new TrayIcons({ roots: [root], cacheDir: null }).resolve({ name: "audio-volume-high", themePath: "", pixmaps: [] });
  expect(icon).toEqual({ kind: "glyph", markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>' });
});

test("a full-color icon at a tray's small sizes, in legacy too", () => {
  expect(smallThemedFile("network-idle", [root])).toBe(join(root, "AdwaitaLegacy/22x22/legacy/network-idle.png"));
  const icon = new TrayIcons({ roots: [root], cacheDir: null }).resolve({ name: "network-idle", themePath: "", pixmaps: [] });
  expect(icon).toEqual({ kind: "image", path: join(root, "AdwaitaLegacy/22x22/legacy/network-idle.png") });
});
