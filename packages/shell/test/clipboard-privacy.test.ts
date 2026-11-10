import { expect, test } from "bun:test";
import { DEFAULT_LEFT_OUT, isLeftOut, leftOutApps, withoutApp } from "../src/clipboard/left-out.ts";
import { imageSize } from "../src/clipboard/lib/images.ts";
import { chooseType, concealedByType, hintIsSecret, verdict } from "../src/clipboard/lib/privacy.ts";
import { copyFrom, fileUris } from "../src/clipboard/lib/watch.ts";
import { parseEvent } from "../src/compositor.ts";

// Clipboard history's privacy rules (docs/betterments.html, "Clipboard
// history and snippets"): what is never kept, and what is kept as what.

const facts = (over: Partial<Parameters<typeof verdict>[0]> = {}) => ({
  mimeTypes: ["text/plain;charset=utf-8", "text/plain"],
  app: { appId: "dev.dashi.notes", program: "bun" },
  vault: false,
  passwordField: false,
  paused: false,
  ...over,
});

test("text is kept as text, a picture as a picture (PNG first), files as their URI list", () => {
  expect(verdict(facts(), DEFAULT_LEFT_OUT)).toEqual({ keep: { kind: "text", mime: "text/plain;charset=utf-8" }, readHint: false });
  expect(chooseType(["image/jpeg", "image/png", "text/html"])).toEqual({ kind: "image", mime: "image/png" });
  expect(chooseType(["x-special/gnome-copied-files", "text/uri-list", "text/plain"])).toEqual({ kind: "files", mime: "text/uri-list" });
  expect(chooseType(["UTF8_STRING", "STRING"])).toEqual({ kind: "text", mime: "UTF8_STRING" });
  // An app's own type alone: nothing to keep, and nothing counted as skipped.
  expect(verdict(facts({ mimeTypes: ["application/x-qt-image"] }), DEFAULT_LEFT_OUT)).toEqual({ ignore: true });
});

test("secrets are never kept: password managers' hints and types, the vault, password fields, paused while shared", () => {
  expect(verdict(facts({ mimeTypes: ["text/plain", "org.nspasteboard.ConcealedType"] }), [])).toEqual({ skip: "secret" });
  expect(concealedByType(["application/x-nspasteboard-concealed-type"])).toBe(true);
  expect(verdict(facts({ vault: true }), [])).toEqual({ skip: "secret" });
  expect(verdict(facts({ passwordField: true }), [])).toEqual({ skip: "password field" });
  expect(verdict(facts({ paused: true }), [])).toEqual({ skip: "paused" });
  // KDE's hint is read before anything else is: "secret" (and a hint that can't be read) is a secret.
  const hinted = verdict(facts({ mimeTypes: ["text/plain", "x-kde-passwordManagerHint"] }), []);
  expect(hinted).toEqual({ keep: { kind: "text", mime: "text/plain" }, readHint: true });
  expect(hintIsSecret("secret\n")).toBe(true);
  expect(hintIsSecret(null)).toBe(true);
  expect(hintIsSecret("not")).toBe(false);
});

test("password managers are left out by app id or program, any case, from an editable list", () => {
  expect(isLeftOut({ appId: "org.keepassxc.KeePassXC" }, DEFAULT_LEFT_OUT)).toBe(true);
  expect(isLeftOut({ appId: "", program: "KeePassXC" }, DEFAULT_LEFT_OUT)).toBe(true);
  expect(isLeftOut({ appId: "dev.dashi.notes", program: "bun" }, DEFAULT_LEFT_OUT)).toBe(false);
  expect(verdict(facts({ app: { appId: "1Password" } }), DEFAULT_LEFT_OUT)).toEqual({ skip: "left out" });
  expect(verdict(facts({ app: { appId: "1Password" } }), [])).toMatchObject({ keep: { kind: "text" } });
});

test("Settings lists each left-out app once, and removing it takes all its ids", () => {
  const apps = leftOutApps(DEFAULT_LEFT_OUT);
  expect(apps.map((app) => app.name)).toEqual(["KeePassXC", "Bitwarden", "1Password", "Passwords and Keys"]);
  expect(apps[1]?.ids).toEqual(["Bitwarden", "bitwarden", "com.bitwarden.desktop"]);
  expect(withoutApp(DEFAULT_LEFT_OUT, apps[1] as NonNullable<(typeof apps)[1]>)).toEqual([
    "org.keepassxc.KeePassXC",
    "keepassxc",
    "1Password",
    "1password",
    "org.gnome.seahorse.Application",
    "seahorse",
  ]);
  // Any case of a known id; an id the installed apps know by name joins its app; the rest stand alone, case folded.
  const installed = (id: string) => (id === "com.example.Vault" || id === "vault-gtk" ? { name: "Vault" } : undefined);
  expect(leftOutApps(["KEEPASSXC", "com.example.Vault", "vault-gtk", "Tool", "tool", "other"], installed)).toEqual([
    { name: "KeePassXC", ids: ["KEEPASSXC"] },
    { name: "Vault", ids: ["com.example.Vault", "vault-gtk"] },
    { name: "Tool", ids: ["Tool", "tool"] },
    { name: "other", ids: ["other"] },
  ]);
});

test("a copy read is made into what the history keeps", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  expect(copyFrom({ kind: "text", mime: "text/plain" }, encode("  \n"), { name: "Notes" })).toBeNull();
  expect(copyFrom({ kind: "text", mime: "text/plain" }, encode("git push"), { name: "Terminal", appId: "dev.dashi.terminal" })).toEqual({
    kind: "text",
    mime: "text/plain;charset=utf-8",
    text: "git push",
    app: "Terminal",
    appId: "dev.dashi.terminal",
  });
  expect(fileUris("copy\nfile:///home/alexk/a.txt\nfile:///home/alexk/b%20c.png\n")).toEqual(["file:///home/alexk/a.txt", "file:///home/alexk/b%20c.png"]);
  expect(copyFrom({ kind: "files", mime: "x-special/gnome-copied-files" }, encode("cut\nfile:///home/alexk/a.txt"), { name: "Files" })).toMatchObject({
    kind: "files",
    mime: "text/uri-list",
    text: "file:///home/alexk/a.txt\r\n",
  });
});

test("a picture's size comes from its header", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 1646);
  new DataView(png.buffer).setUint32(20, 937);
  expect(imageSize(png)).toEqual({ width: 1646, height: 937 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00]);
  expect(imageSize(gif)).toEqual({ width: 32, height: 16 });
  // JPEG: SOI, an APP0 of 4 bytes, then SOF0 with height 300 and width 400.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
  expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
  expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
});

test("the compositor's copies and keywords are parsed, and anything odd is dropped", () => {
  expect(parseEvent({ event: "selection", mimeTypes: ["text/plain", 3], window: 4 })).toEqual({ event: "selection", mimeTypes: ["text/plain"], window: 4 });
  expect(parseEvent({ event: "selection", mimeTypes: [], window: null, x11: true })).toEqual({ event: "selection", mimeTypes: [], window: null, x11: true });
  expect(parseEvent({ event: "selection", mimeTypes: "text/plain", window: 4 })).toBeNull();
  expect(parseEvent({ event: "snippet", keyword: ";addr", window: 7 })).toEqual({ event: "snippet", keyword: ";addr", window: 7 });
  expect(parseEvent({ event: "snippet", keyword: ";addr" })).toBeNull();
});
