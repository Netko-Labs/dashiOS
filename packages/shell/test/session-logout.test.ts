/**
 * Logging out: the session's own units are stopped before the login is ended, since ending it
 * kills the session at once and nothing it does on its way out is sure to run.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STALE_UNITS } from "../src/session/lib/portal-files.ts";
import { TARGET } from "../src/session/lib/target.ts";
import { endLogin, logoutCommands, planLogout, SESSION_UNITS } from "../src/shared/session-power/index.ts";

test("a logout stops the session's units, waits, and only then ends the login", async () => {
  const ran: string[] = [];
  let stopping = false;
  await endLogin("1483", async (command) => {
    if (command[0] === "systemctl") {
      stopping = true;
      await Promise.resolve();
      stopping = false;
    }
    // The login is never ended while the units are still being stopped.
    expect(stopping).toBe(false);
    ran.push(command.join(" "));
  });
  expect(ran).toEqual([
    "systemctl --user stop dashi-session.target dashi-portal*.service dbus-*-org.freedesktop.impl.portal.desktop.dashi@*.service",
    "loginctl terminate-session 1483",
  ]);
  expect(logoutCommands("1483").at(-1)).toEqual(["loginctl", "terminate-session", "1483"]);
});

test("the units a logout stops are the ones the session's supervisor stops", () => {
  expect([...SESSION_UNITS]).toEqual([TARGET, ...STALE_UNITS]);
});

test("a logout that could not stop the units still ends the login", async () => {
  const ran: string[] = [];
  await endLogin("7", async (command) => {
    ran.push(command[0] ?? "");
  });
  expect(ran).toEqual(["systemctl", "loginctl"]);
  // Only a real login is ended this way: nested, the compositor is stopped instead.
  expect(planLogout({ session: "7", compositor: 10, nested: true })).toEqual({ kind: "signal", pid: 10 });
  expect(planLogout({ session: "7", compositor: 10, nested: false })).toEqual({ kind: "loginctl", session: "7" });
});

test("stopping the session's target stops the graphical session with it", () => {
  // graphical-session.target is what xdg-desktop-portal and Dashi's portal backend are part of: left up
  // after a logout, the portal started the backend again at the login screen, where it has no compositor.
  const unit = readFileSync(new URL("../../../session/dashi-session.target", import.meta.url), "utf8");
  expect(unit).toContain("\nBindsTo=graphical-session.target\n");
  expect(unit).toContain("\nPropagatesStopTo=graphical-session.target\n");
});
