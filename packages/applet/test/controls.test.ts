/**
 * Control Center's controls (protocol 5, src/controls.ts): the manifest's
 * `controls` and the `controls` permission they need, the wire both ways,
 * the limits (8 controls, 4 updates a second each), and the SDK's
 * `controls.update / on / onOpen`.
 */

import { expect, test } from "bun:test";
import {
  AppletsClient,
  CONTROL_SPACING_MS,
  checkUpdate,
  consentLines,
  controlsApi,
  type Manifest,
  manifestJson,
  parseAppletMessage,
  parseAppletShellMessage,
  parseManifest,
  parsePermission,
  permissionName,
  type SocketHandlers,
} from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

const line = (value: unknown): string => JSON.stringify(value);
const noFiles = (): null => null;

const CONTROLS = [
  { id: "lid", kind: "toggle", title: "Lid light", icon: "icons/lid.svg" },
  { id: "fans", kind: "choice", title: "Fans", choices: ["Quiet", "Auto", "Max"] },
  { id: "boost", kind: "slider", title: "Boost", min: 0, max: 40 },
  { id: "cpu", kind: "status", title: "CPU" },
];

const withControls = (controls: unknown, permissions: string[] = [...ASUS.permissions, "controls"]) => parseManifest({ ...ASUS, permissions, controls });

test("controls is a permission that grants nothing else, said as such on the consent sheet", () => {
  expect(parsePermission("controls")).toEqual({ kind: "controls" });
  expect(permissionName({ kind: "controls" })).toBe("controls");
  expect(consentLines([{ kind: "controls" }])).toEqual(["Add controls to Control Center"]);
});

test("the manifest's controls: their kinds, sizes by kind, choices and ranges; they need the permission", () => {
  const manifest = withControls(CONTROLS) as Manifest;
  expect(manifest.controls.map((control) => `${control.id}:${control.kind}:${control.sizes.join("/")}`)).toEqual([
    "lid:toggle:round/wide",
    "fans:choice:wide/round",
    "boost:slider:flat/tall",
    "cpu:status:wide/round",
  ]);
  expect(manifest.controls[2]).toMatchObject({ min: 0, max: 40 });
  // Written back as it was declared: no choices on a toggle, no range on a status.
  expect(manifestJson(manifest).controls).toEqual([
    { id: "lid", kind: "toggle", title: "Lid light", icon: "icons/lid.svg", sizes: ["round", "wide"] },
    { id: "fans", kind: "choice", title: "Fans", sizes: ["wide", "round"], choices: ["Quiet", "Auto", "Max"] },
    { id: "boost", kind: "slider", title: "Boost", sizes: ["flat", "tall"], min: 0, max: 40 },
    { id: "cpu", kind: "status", title: "CPU", sizes: ["wide", "round"] },
  ]);
  expect(withControls(CONTROLS, ASUS.permissions)).toEqual({ error: "controls need the “controls” permission" });
  const refused = (controls: unknown) => (withControls(controls) as { error?: string }).error ?? "";
  expect(refused(Array.from({ length: 9 }, (_, at) => ({ id: `c${at}`, kind: "button", title: "Go" })))).toContain("more than 8");
  expect(refused([{ id: "a", kind: "dial", title: "A" }])).toContain("kind must be one of");
  expect(refused([{ id: "a", kind: "toggle", title: "A", sizes: ["tall"] }])).toContain("round, wide");
  expect(refused([{ id: "a", kind: "choice", title: "A", choices: ["Only"] }])).toContain("2 to 5");
  expect(refused([{ id: "a", kind: "toggle", title: "A", choices: ["x", "y"] }])).toContain("only a choice");
  expect(refused([{ id: "a", kind: "slider", title: "A", min: 5, max: 5 }])).toContain("above min");
  expect(refused([{ id: "a", kind: "toggle", title: "A", icon: "../x.svg" }])).toContain("inside the applet");
  expect(refused([{ id: "a", kind: "toggle", title: "x".repeat(25) }])).toContain("24 characters");
  expect(refused([CONTROLS[0], CONTROLS[0]])).toContain("twice");
});

test("an applet's state: protocol 5 only, its parts checked, a glyph by the menu bar's rules", () => {
  expect(parseAppletMessage(line({ type: "control", id: "lid", on: true, detail: "Bounce" }), noFiles, 5)).toEqual({
    type: "control",
    id: "lid",
    on: true,
    detail: "Bounce",
  });
  expect(parseAppletMessage(line({ type: "control", id: "lid", on: true }), noFiles, 4)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "control", id: "lid", on: "yes" }), noFiles, 5)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "control", id: "lid", detail: "x".repeat(41) }), noFiles, 5)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "control", id: "lid", speed: 3 }), noFiles, 5)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "control", id: "lid", glyph: '<svg><use href="#x"/></svg>' }), noFiles, 5)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "control", id: "lid", detail: null }), noFiles, 5)).toEqual({ type: "control", id: "lid", detail: null });
  const manifest = withControls(CONTROLS) as Manifest;
  const [lid, fans, boost] = manifest.controls;
  if (!lid || !fans || !boost) throw new Error("controls");
  expect(checkUpdate(lid, { id: "lid", on: true })).toBeNull();
  expect(checkUpdate(fans, { id: "fans", on: true })).toContain("only a toggle");
  expect(checkUpdate(fans, { id: "fans", choice: "Turbo" })).toContain("isn't one of its choices");
  expect(checkUpdate(boost, { id: "boost", value: 41 })).toContain("from 0 to 40");
  expect(checkUpdate(boost, { id: "boost", value: 12 })).toBeNull();
});

test("the shell's messages: which controls are shown, and what was pressed; anything else is skipped", () => {
  expect(parseAppletShellMessage(line({ type: "controls", shown: ["lid", "cpu"] }))).toEqual({ type: "controls", shown: ["lid", "cpu"] });
  expect(parseAppletShellMessage(line({ type: "controls", shown: [1] }))).toBeNull();
  expect(parseAppletShellMessage(line({ type: "control-action", id: "lid", action: "toggle", on: false }))).toEqual({
    type: "control-action",
    id: "lid",
    action: "toggle",
    on: false,
  });
  expect(parseAppletShellMessage(line({ type: "control-action", id: "fans", action: "choose", choice: "Max" }))).toMatchObject({ choice: "Max" });
  expect(parseAppletShellMessage(line({ type: "control-action", id: "boost", action: "set", value: 12 }))).toMatchObject({ value: 12 });
  expect(parseAppletShellMessage(line({ type: "control-action", id: "cpu", action: "open" }))).toMatchObject({ action: "open" });
  expect(parseAppletShellMessage(line({ type: "control-action", id: "lid", action: "toggle" }))).toBeNull();
  expect(parseAppletShellMessage(line({ type: "control-action", id: "lid", action: "explode" }))).toBeNull();
});

function fakeShell() {
  const sent: Array<Record<string, unknown>> = [];
  let handlers: SocketHandlers | null = null;
  const timers: Array<{ at: number; fn: () => void }> = [];
  let clock = 0;
  const connect = (_path: string, given: SocketHandlers): void => {
    handlers = given;
    given.open({
      write: (data) => {
        for (const part of new TextDecoder().decode(data).split("\n")) if (part) sent.push(JSON.parse(part));
        return data.byteLength;
      },
      end: () => {},
    });
  };
  const reply = (message: unknown): void => handlers?.data(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  const advance = (ms: number): void => {
    clock += ms;
    for (const timer of timers.filter((each) => each.at <= clock)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    }
  };
  return {
    sent,
    connect,
    reply,
    advance,
    now: () => clock,
    later: (fn: () => void, ms: number) => {
      const timer = { at: clock + ms, fn };
      timers.push(timer);
      return () => timers.includes(timer) && timers.splice(timers.indexOf(timer), 1);
    },
  };
}

function client(shell: ReturnType<typeof fakeShell>): AppletsClient {
  const manifest = withControls(CONTROLS) as Manifest;
  const made = new AppletsClient({ path: "/run/x.sock", manifest, connect: shell.connect, exists: () => true, later: shell.later, now: shell.now });
  made.show({ id: "asus", title: "ASUS Control", label: "54°" });
  return made;
}

test("the client: states wait for a welcome at 5, go whole, at most 4 a second each, and again on every welcome", () => {
  const shell = fakeShell();
  const applets = client(shell);
  expect(applets.updateControl({ id: "lid", on: true, detail: "Bounce" })).toBe(true);
  expect(applets.updateControl({ id: "nope", on: true })).toBe(false);
  expect(shell.sent.some((message) => message.type === "control")).toBe(false);
  shell.reply({ type: "welcome", protocol: 5 });
  expect(shell.sent.filter((message) => message.type === "control")).toEqual([{ type: "control", id: "lid", on: true, detail: "Bounce" }]);
  // Three more within the quarter second: one waits, and goes with the newest.
  applets.updateControl({ id: "lid", on: false });
  applets.updateControl({ id: "lid", detail: "Rain" });
  applets.updateControl({ id: "cpu", detail: "71 °C · 3,400 rpm" });
  expect(shell.sent.filter((message) => message.type === "control")).toHaveLength(2);
  shell.advance(CONTROL_SPACING_MS);
  expect(shell.sent.filter((message) => message.type === "control").at(-1)).toEqual({ type: "control", id: "lid", on: false, detail: "Rain" });
  // An older shell (welcome at 4) is never sent one.
  const older = fakeShell();
  const old = client(older);
  older.reply({ type: "welcome", protocol: 4 });
  old.updateControl({ id: "lid", on: true });
  older.reply({ type: "control-action", id: "lid", action: "toggle", on: true });
  expect(older.sent.some((message) => message.type === "control")).toBe(false);
  expect(old.drawsControls).toBe(false);
});

test("the SDK: on hears presses, onOpen the label (the popover when no one listens), shown follows the shell", () => {
  const shell = fakeShell();
  const applets = client(shell);
  let opened = 0;
  const controls = controlsApi(applets, () => opened++);
  const heard: unknown[] = [];
  const stop = controls.on("lid", (action) => heard.push(action));
  const shown: Array<readonly string[]> = [];
  controls.onShown((ids) => shown.push(ids));
  let openedCpu = 0;
  controls.onOpen("cpu", () => openedCpu++);
  shell.reply({ type: "welcome", protocol: 5 });
  shell.reply({ type: "controls", shown: ["lid"] });
  shell.reply({ type: "control-action", id: "lid", action: "toggle", on: false });
  shell.reply({ type: "control-action", id: "cpu", action: "open" });
  shell.reply({ type: "control-action", id: "fans", action: "open" });
  expect(heard).toEqual([{ action: "toggle", on: false }]);
  expect(openedCpu).toBe(1);
  expect(opened).toBe(1);
  expect(controls.shown).toEqual(["lid"]);
  expect(shown).toEqual([["lid"]]);
  stop();
  shell.reply({ type: "control-action", id: "lid", action: "toggle", on: true });
  expect(heard).toHaveLength(1);
  expect(controls.update("lid", { on: true })).toBe(true);
  expect(shell.sent.at(-1)).toEqual({ type: "control", id: "lid", on: true });
});
