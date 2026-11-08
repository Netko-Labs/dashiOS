/**
 * Applets' controls in Control Center, the shell's side (applets/controls.ts
 * and the connection): declared ones are in Add before the applet runs, a
 * protocol 5 connection with the permission says their state and hears the
 * presses, updates are checked and spaced to 4 a second, the applet hears
 * which are shown, a press on one that isn't running starts it, and the
 * last state is kept for a dimmed tile.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InstalledApplet, type Manifest, parseManifest } from "@dashi/applet";
import type { AppletContext } from "../src/applets/connection.ts";
import { AppletControls, parseStates } from "../src/applets/controls.ts";
import { AppletConnection } from "../src/applets/server.ts";
import type { Layout } from "../src/control-center/layout.ts";
import { ExtrasStore } from "../src/extras/index.ts";

const MANIFEST = {
  id: "dev.netko.asus-control",
  name: "ASUS Control",
  version: "0.3.0",
  dashi: ">=0.5",
  entry: "src/main.tsx",
  summary: "Fans, power and lights for ROG and TUF laptops.",
  author: { name: "Alex Kim" },
  permissions: ["hardware.lighting", "controls"],
  controls: [
    { id: "lid", kind: "toggle", title: "Lid light", icon: "icons/lid.svg" },
    { id: "fans", kind: "choice", title: "Fans", choices: ["Quiet", "Auto", "Max"] },
    { id: "cpu", kind: "status", title: "CPU" },
  ],
};

function manifest(extra: Record<string, unknown> = {}): Manifest {
  const parsed = parseManifest({ ...MANIFEST, ...extra });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

const LID = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 13h12"/></svg>';

function setup(layout: Layout = [{ id: "applet:dev.netko.asus-control/lid", size: "wide" }], statePath: string | null = null) {
  let current = layout;
  const layoutListeners = new Set<() => void>();
  const timers: Array<{ at: number; fn: () => void }> = [];
  let clock = 1000;
  const woken: string[] = [];
  const controls = new AppletControls({
    layout: () => current,
    subscribeLayout: (listener) => {
      layoutListeners.add(listener);
      return () => layoutListeners.delete(listener);
    },
    statePath,
    readIcon: (path) => (path.endsWith("icons/lid.svg") ? LID : null),
    now: () => clock,
    later: (fn, ms) => {
      const timer = { at: clock + ms, fn };
      timers.push(timer);
      return () => timers.includes(timer) && timers.splice(timers.indexOf(timer), 1);
    },
  });
  controls.setWake((id) => woken.push(id));
  return {
    controls,
    woken,
    setLayout(next: Layout) {
      current = next;
      for (const listener of layoutListeners) listener();
    },
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.filter((each) => each.at <= clock)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

function connection(controls: AppletControls, extra: Partial<AppletContext> = {}) {
  const written: Array<Record<string, unknown>> = [];
  const wire = {
    write: (data: Uint8Array) => {
      for (const line of new TextDecoder().decode(data).split("\n")) if (line) written.push(JSON.parse(line));
      return data.byteLength;
    },
    terminate: () => {},
  };
  const conn = new AppletConnection(4242, wire, { extras: new ExtrasStore(), controls, ...extra });
  const send = (message: unknown) => conn.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  return { conn, written, send };
}

const installed = (made: Manifest): InstalledApplet => ({ dir: "/apps/asus", manifest: made, record: { consent: [] } }) as unknown as InstalledApplet;

test("an installed applet's controls are in Add before it runs: its icon, not running, nothing on", () => {
  const { controls } = setup();
  controls.setInstalled([installed(manifest())]);
  const tiles = controls.getSnapshot();
  expect(tiles.map((tile) => `${tile.key} ${tile.kind} ${tile.running ? "running" : "asleep"}`)).toEqual([
    "applet:dev.netko.asus-control/lid toggle asleep",
    "applet:dev.netko.asus-control/fans choice asleep",
    "applet:dev.netko.asus-control/cpu status asleep",
  ]);
  expect(tiles[0]?.glyph).toBe(LID);
  expect(tiles[1]?.glyph).toContain("<svg");
  expect(tiles[1]?.choices).toEqual(["Quiet", "Auto", "Max"]);
  // Without the permission an installed one's controls aren't offered.
  controls.setInstalled([installed({ ...manifest(), permissions: manifest().permissions.filter((each) => each.kind !== "controls") })]);
  expect(controls.getSnapshot()).toEqual([]);
});

test("a protocol 5 hello: told what is shown, its state taken, a press sent back; a press while it's gone starts it", () => {
  const h = setup();
  h.controls.setInstalled([installed(manifest())]);
  const { written, send, conn } = connection(h.controls, { installed: manifest() });
  send({ type: "hello", protocol: 5, manifest: MANIFEST });
  expect(written[0]).toEqual({ type: "welcome", protocol: 5 });
  expect(written).toContainEqual({ type: "controls", shown: ["lid"] });
  send({ type: "control", id: "lid", on: true, detail: "Bounce" });
  const lid = () => h.controls.getSnapshot().find((tile) => tile.key.endsWith("/lid"));
  expect(lid()).toMatchObject({ on: true, detail: "Bounce", running: true });
  h.controls.act("applet:dev.netko.asus-control/lid", { kind: "toggle", on: false });
  expect(written.at(-1)).toEqual({ type: "control-action", id: "lid", action: "toggle", on: false });
  h.controls.act("applet:dev.netko.asus-control/fans", { kind: "choose", choice: "Max" });
  expect(written.at(-1)).toEqual({ type: "control-action", id: "fans", action: "choose", choice: "Max" });
  // The layout changes: it hears the new list, and only on a change.
  h.setLayout([
    { id: "applet:dev.netko.asus-control/cpu", size: "wide" },
    { id: "wifi", size: "wide" },
  ]);
  expect(written.at(-1)).toEqual({ type: "controls", shown: ["cpu"] });
  h.setLayout([{ id: "applet:dev.netko.asus-control/cpu", size: "round" }]);
  expect(written.filter((message) => message.type === "controls")).toHaveLength(2);
  conn.closedBySocket();
  expect(lid()).toMatchObject({ on: true, detail: "Bounce", running: false });
  h.controls.act("applet:dev.netko.asus-control/lid", { kind: "toggle", on: false });
  expect(h.woken).toEqual(["dev.netko.asus-control"]);
});

test("updates are checked against the manifest and refused with a reason; an older protocol can't send them", () => {
  const h = setup();
  const { written, send } = connection(h.controls);
  send({ type: "hello", protocol: 5, manifest: MANIFEST });
  send({ type: "control", id: "fans", choice: "Turbo" });
  expect(written.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("isn't one of its choices") });
  send({ type: "control", id: "nope", on: true });
  expect(written.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("no control “nope”") });
  // A developer's applet: its controls are offered while it is connected.
  expect(h.controls.getSnapshot().map((tile) => tile.key)).toContain("applet:dev.netko.asus-control/cpu");
  const older = connection(h.controls);
  older.send({ type: "hello", protocol: 4, manifest: MANIFEST });
  older.send({ type: "control", id: "lid", on: true });
  expect(older.written.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("protocol 5") });
  // A manifest without the permission can't be parsed at all; one with no controls has nothing to say.
  const plain = connection(h.controls);
  plain.send({ type: "hello", protocol: 5, manifest: { ...MANIFEST, permissions: ["hardware.lighting"], controls: undefined } });
  plain.send({ type: "control", id: "lid", on: true });
  expect(plain.written.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("controls") });
});

test("at most 4 updates a second per control: one waits and carries the newest; the last state is kept on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "applet-controls-"));
  try {
    const path = join(dir, "state.json");
    const h = setup(undefined, path);
    const { send } = connection(h.controls);
    send({ type: "hello", protocol: 5, manifest: MANIFEST });
    let heard = 0;
    h.controls.subscribe(() => heard++);
    send({ type: "control", id: "cpu", detail: "60 °C" });
    send({ type: "control", id: "cpu", detail: "61 °C" });
    send({ type: "control", id: "cpu", detail: "62 °C" });
    const cpu = () => h.controls.getSnapshot().find((tile) => tile.key.endsWith("/cpu"))?.detail;
    expect(cpu()).toBe("60 °C");
    expect(heard).toBe(1);
    h.advance(250);
    expect(cpu()).toBe("62 °C");
    expect(heard).toBe(2);
    h.advance(1000);
    expect(parseStates(readFileSync(path, "utf8")).get("applet:dev.netko.asus-control/cpu")).toEqual({ detail: "62 °C" });
    // A new shell reads it back: the tile shows its last state while the applet isn't there.
    const again = setup(undefined, path);
    again.controls.setInstalled([installed(manifest())]);
    expect(again.controls.getSnapshot().find((tile) => tile.key.endsWith("/cpu"))).toMatchObject({ detail: "62 °C", running: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(parseStates('{"applet:x/y":{"on":"yes","detail":3},"wifi":{"on":true}}')).toEqual(new Map([["applet:x/y", {}]]));
});
