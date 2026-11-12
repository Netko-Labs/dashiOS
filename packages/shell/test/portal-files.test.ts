import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { startSessionTarget, stopSessionTarget, TARGET } from "../src/session/lib/target.ts";

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
