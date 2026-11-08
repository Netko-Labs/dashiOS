import { expect, test } from "bun:test";
import {
  AppletsClient,
  consentLines,
  type Manifest,
  type PowerState,
  parseAppletMessage,
  parseAppletShellMessage,
  parseManifest,
  parsePermission,
  permissionName,
  type SocketHandlers,
} from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

const noFiles = (): null => null;
const line = (value: unknown): string => JSON.stringify(value);

const STATE: PowerState = {
  choice: "automatic",
  available: ["low-power", "balanced", "performance"],
  mode: "performance",
  automatic: true,
  why: "Automatic chose High Performance: plugged in",
  failed: false,
};

test("power.mode is a permission, in words on the consent sheet", () => {
  const permission = parsePermission("power.mode");
  expect(permission).toEqual({ kind: "power-mode" });
  expect(permissionName({ kind: "power-mode" })).toBe("power.mode");
  expect(consentLines([{ kind: "power-mode" }])).toEqual(["See and choose the power mode, Automatic included"]);
  expect(parsePermission("power.modes")).toHaveProperty("error");
  const manifest = parseManifest({ ...ASUS, permissions: [...ASUS.permissions, "power.mode"] });
  expect(manifest).toMatchObject({ permissions: expect.arrayContaining([{ kind: "power-mode" }]) });
});

test("an applet's ask: protocol 4 only, a known choice, nothing else", () => {
  expect(parseAppletMessage(line({ type: "power", choice: "low-power" }), noFiles, 4)).toEqual({ type: "power", choice: "low-power" });
  expect(parseAppletMessage(line({ type: "power", choice: "automatic" }), noFiles, 4)).toEqual({ type: "power", choice: "automatic" });
  expect(parseAppletMessage(line({ type: "power", choice: "low-power" }), noFiles, 3)).toMatchObject({ error: expect.stringContaining("protocol 4") });
  expect(parseAppletMessage(line({ type: "power", choice: "turbo" }), noFiles, 4)).toMatchObject({ error: expect.stringContaining("choice must be") });
  expect(parseAppletMessage(line({ type: "power" }), noFiles, 4)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "power", choice: "balanced", why: "because" }), noFiles, 4)).toMatchObject({
    error: expect.stringContaining("unknown field “why”"),
  });
});

test("the shell's state: read whole, or skipped when it doesn't read", () => {
  expect(parseAppletShellMessage(line({ type: "power", ...STATE }))).toEqual({ type: "power", ...STATE });
  // Before the power source is known.
  expect(parseAppletShellMessage(line({ type: "power", ...STATE, mode: null, why: null, automatic: false }))).toMatchObject({ mode: null, why: null });
  // The modes come in Dashi's order, whatever the order sent.
  expect(parseAppletShellMessage(line({ type: "power", ...STATE, available: ["performance", "low-power"] }))).toMatchObject({
    available: ["low-power", "performance"],
  });
  expect(parseAppletShellMessage(line({ type: "power", ...STATE, choice: "turbo" }))).toBeNull();
  expect(parseAppletShellMessage(line({ type: "power", ...STATE, available: ["warp"] }))).toBeNull();
  expect(parseAppletShellMessage(line({ type: "power", ...STATE, failed: "no" }))).toBeNull();
  expect(parseAppletShellMessage(line({ type: "power", ...STATE, why: "x".repeat(201) }))).toBeNull();
});

function fakeShell() {
  const sent: Array<Record<string, unknown>> = [];
  let handlers: SocketHandlers | null = null;
  const later: Array<() => void> = [];
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
  return { sent, connect, reply, drop: () => handlers?.close(), retry: () => later.shift()?.(), later };
}

function client(shell: ReturnType<typeof fakeShell>): AppletsClient {
  const manifest = parseManifest({ ...ASUS, permissions: [...ASUS.permissions, "power.mode"] }) as Manifest;
  const made = new AppletsClient({
    path: "/run/x.sock",
    manifest,
    connect: shell.connect,
    exists: () => true,
    later: (fn) => {
      shell.later.push(fn);
      return () => {};
    },
  });
  made.show({ id: "asus", title: "ASUS Control", label: "54°" });
  return made;
}

test("the client: hello at 4; the power mode only when the shell speaks 4 and says it", () => {
  const shell = fakeShell();
  const applets = client(shell);
  const heard: Array<PowerState | null> = [];
  applets.onPowerMode((state) => heard.push(state));
  expect(shell.sent[0]).toMatchObject({ type: "hello", protocol: 4 });
  // An older Dashi: welcome at 3, and a stray power line isn't believed.
  shell.reply({ type: "welcome", protocol: 3 });
  shell.reply({ type: "power", ...STATE });
  expect(applets.powerMode).toBeNull();
  expect(applets.choosePowerMode("low-power")).toBe(false);
  expect(shell.sent.some((message) => message.type === "power")).toBe(false);
  expect(heard).toEqual([]);
});

test("the client: Dashi's state heard, a choice asked for, and null again when the shell goes", () => {
  const shell = fakeShell();
  const applets = client(shell);
  const heard: Array<PowerState | null> = [];
  applets.onPowerMode((state) => heard.push(state));
  shell.reply({ type: "welcome", protocol: 4 });
  // Without power.mode granted the shell says nothing: still nothing to use.
  expect(applets.powerMode).toBeNull();
  shell.reply({ type: "power", ...STATE });
  expect(applets.powerMode).toEqual(STATE);
  // The same state again isn't news.
  shell.reply({ type: "power", ...STATE });
  expect(heard).toEqual([STATE]);
  expect(applets.choosePowerMode("low-power")).toBe(true);
  expect(shell.sent.at(-1)).toEqual({ type: "power", choice: "low-power" });
  expect(applets.choosePowerMode("automatic")).toBe(true);
  expect(shell.sent.at(-1)).toEqual({ type: "power", choice: "automatic" });
  // A mode the machine lacks isn't asked for.
  shell.reply({ type: "power", ...STATE, available: ["low-power", "balanced"], mode: "balanced" });
  expect(applets.choosePowerMode("performance")).toBe(false);
  shell.drop();
  expect(applets.powerMode).toBeNull();
  expect(heard.at(-1)).toBeNull();
  // Back, and told again.
  shell.retry();
  shell.reply({ type: "welcome", protocol: 4 });
  shell.reply({ type: "power", ...STATE });
  expect(applets.powerMode).toEqual(STATE);
});
