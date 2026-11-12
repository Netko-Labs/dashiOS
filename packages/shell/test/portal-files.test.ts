import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECKOUT_UNIT,
  checkoutService,
  checkoutUnit,
  execWord,
  forgetCheckoutPortal,
  linkCheckoutPortal,
  STALE_UNITS,
  stopsOnlyLoaded,
} from "../src/session/lib/portal-files.ts";
import { startSessionTarget, stopNowCommand, stopSessionTarget, stopSessionTargetNow, TARGET } from "../src/session/lib/target.ts";

/** A scratch home with a checkout's session dir; removed after `body`. */
async function withCheckout(body: (paths: { session: string; data: string; config: string }) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "dashi-portal-files-"));
  const session = join(root, "session");
  try {
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, "dashi.portal"), "[portal]\n");
    writeFileSync(join(session, "dashi-portal"), "#!/bin/sh\n");
    await body({ session, data: join(root, "data"), config: join(root, "config") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a checkout's session links dashi.portal and writes a unit and a service file; an installed one removes only those", async () => {
  await withCheckout(({ session, data, config }) => {
    const env = { XDG_DATA_HOME: data, XDG_CONFIG_HOME: config };
    expect(linkCheckoutPortal(session, env, () => {})).toEqual({ unit: true, service: true });
    expect(readFileSync(join(data, "xdg-desktop-portal/portals/dashi.portal"), "utf8")).toBe("[portal]\n");
    const service = join(data, "dbus-1/services/org.freedesktop.impl.portal.desktop.dashi.service");
    const unit = join(config, "systemd/user", CHECKOUT_UNIT);
    expect(readFileSync(service, "utf8")).toBe(checkoutService(session));
    expect(readFileSync(unit, "utf8")).toBe(checkoutUnit(session));
    // The bus starts the unit, which ends with the graphical session.
    expect(checkoutService(session)).toContain(`SystemdService=${CHECKOUT_UNIT}`);
    expect(checkoutUnit(session)).toContain("PartOf=graphical-session.target");
    expect(checkoutUnit(session)).toContain(`ExecStart=${session}/dashi-portal`);
    // Written again unchanged: nothing to reload.
    expect(linkCheckoutPortal(session, env, () => {})).toEqual({ unit: false, service: false });
    expect(forgetCheckoutPortal(env)).toEqual({ unit: true, service: true });
    expect(existsSync(service)).toBe(false);
    expect(existsSync(unit)).toBe(false);
    // One the person wrote stays.
    writeFileSync(service, "[D-BUS Service]\nName=mine\n");
    expect(linkCheckoutPortal(session, env, () => {}).service).toBe(false);
    expect(forgetCheckoutPortal(env).service).toBe(false);
    expect(readFileSync(service, "utf8")).toBe("[D-BUS Service]\nName=mine\n");
  });
});

test("a path is one word of ExecStart", () => {
  expect(execWord("/home/alexk/dashi/session/dashi-portal")).toBe("/home/alexk/dashi/session/dashi-portal");
  expect(execWord("/home/alexk/my dashi/dashi-portal")).toBe('"/home/alexk/my dashi/dashi-portal"');
  expect(execWord('/srv/100%/$x/a"b')).toBe('"/srv/100%%/$$x/a\\"b"');
});

test("each session starts with no portal backend left from an earlier one, and stops its own as it ends", async () => {
  await withCheckout(async ({ session, data, config }) => {
    const ran: string[] = [];
    const deps = {
      env: { XDG_DATA_HOME: data, XDG_CONFIG_HOME: config, HOME: config, DASHI_SESSION_FILES: session },
      which: (program: string) => `/usr/bin/${program}`,
      run: async (command: readonly string[]) => {
        ran.push(command.join(" "));
        return null;
      },
      log: () => {},
    };
    await startSessionTarget(deps);
    const stops = STALE_UNITS.map((unit) => `systemctl --user stop ${unit}`);
    expect(ran).toContain("systemctl --user daemon-reload");
    expect(ran.some((command) => command.endsWith("org.freedesktop.DBus ReloadConfig"))).toBe(true);
    // The old transient unit (a service file without a unit) is among those stopped.
    expect(stops.some((stop) => stop.includes("dbus-*-org.freedesktop.impl.portal.desktop.dashi@*.service"))).toBe(true);
    const start = ran.indexOf(`systemctl --user start ${TARGET}`);
    for (const stop of stops) expect(ran.indexOf(stop)).toBeGreaterThan(-1);
    for (const stop of stops) expect(ran.indexOf(stop)).toBeLessThan(start);
    // The next session, files unchanged: no reloads, the same stops.
    ran.length = 0;
    await startSessionTarget(deps);
    expect(ran).not.toContain("systemctl --user daemon-reload");
    expect(ran.filter((command) => stops.includes(command))).toEqual(stops);
    ran.length = 0;
    await stopSessionTarget(deps);
    expect(ran).toEqual([`systemctl --user stop ${TARGET}`, ...stops]);
  });
});

test("the backend's units are stopped by pattern: no unit is loaded to be stopped, so two never claim its bus name at once", () => {
  // A checkout's unit and the installed one both say BusName=org.freedesktop.impl.portal.desktop.dashi,
  // and systemd refuses the second it loads ("Two services allocated for the same bus name").
  expect(checkoutUnit("/home/alexk/dashi/session")).toContain("BusName=org.freedesktop.impl.portal.desktop.dashi");
  for (const unit of STALE_UNITS) expect([unit, stopsOnlyLoaded(unit)]).toEqual([unit, true]);
  expect(stopsOnlyLoaded("dashi-portal.service")).toBe(false);
  expect(stopsOnlyLoaded(CHECKOUT_UNIT)).toBe(false);
  // One pattern takes in both units' names.
  const both = new Bun.Glob("dashi-portal*.service");
  expect(STALE_UNITS).toContain("dashi-portal*.service");
  expect(both.match("dashi-portal.service") && both.match(CHECKOUT_UNIT)).toBe(true);
});

test("a session told to end asks systemd to stop its target and its portal backend at once, without waiting", () => {
  // A logout kills what is left of the session before the shell has stopped: the ask is one command that returns.
  const asked: string[][] = [];
  stopSessionTargetNow({ which: () => "/usr/bin/systemctl", spawn: (command) => asked.push([...command]) });
  expect(asked).toEqual([["systemctl", "--user", "stop", "--no-block", TARGET, ...STALE_UNITS]]);
  expect(stopNowCommand()).toContain("--no-block");
  // The portal's units are named by pattern, so one that is not loaded is left alone.
  expect(STALE_UNITS.every(stopsOnlyLoaded)).toBe(true);
  // No systemd, nothing asked.
  stopSessionTargetNow({ which: () => null, spawn: (command) => asked.push([...command]) });
  expect(asked).toHaveLength(1);
});

test("an installed session removes the session target a checkout linked, and leaves a file the person wrote", async () => {
  await withCheckout(({ session, data, config }) => {
    const env = { XDG_DATA_HOME: data, XDG_CONFIG_HOME: config };
    const units = join(config, "systemd", "user");
    const target = join(units, TARGET);
    mkdirSync(units, { recursive: true });
    writeFileSync(join(session, TARGET), "[Unit]\nDescription=a checkout's\n");
    // `systemctl --user link` leaves a link, which wins over the installed unit.
    symlinkSync(join(session, TARGET), target);
    expect(forgetCheckoutPortal(env)).toEqual({ unit: true, service: false });
    expect(lstatSync(target, { throwIfNoEntry: false })).toBeUndefined();
    // Nothing left to remove: nothing to reload.
    expect(forgetCheckoutPortal(env).unit).toBe(false);
    // A unit the person wrote there is not a link, and stays.
    writeFileSync(target, "[Unit]\nDescription=mine\n");
    expect(forgetCheckoutPortal(env).unit).toBe(false);
    expect(readFileSync(target, "utf8")).toContain("mine");
  });
});
