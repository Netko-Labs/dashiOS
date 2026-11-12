/**
 * Before Dashi types a secret: is the focused field what it should be (a
 * password field for a password, an editable text or password field for a
 * code, AT-SPI says), on a page of the login's site (every web document
 * around the field, frames included, is), in a browser the agent can't read
 * through DevTools? Checked before the sheet is shown and again just before
 * typing. Policy, so tested.
 */

import type { Focused } from "../../atspi/index.ts";
import type { FieldInfo } from "../types.ts";

export type Verdict = { ok: true; focused: Focused } | { ok: false; reason: string };

/** The host of a page's address, if it is one a login may be filled on: https, or http on a loopback name. */
export function pageHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (parsed.protocol === "https:") return host;
  const loopback = host === "localhost" || host.endsWith(".localhost");
  return parsed.protocol === "http:" && loopback ? host : null;
}

/** A login for `site` belongs on `host`: the same host, or one under it. */
export function siteMatches(site: string, host: string): boolean {
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return bare === site || bare.endsWith(`.${site}`);
}

/** Flags that open a browser to DevTools-style control (CDP, Marionette, Firefox's debugger server). */
const DEVTOOLS = [
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "-remote-debugging-port",
  "--remote-allow-origins",
  "--marionette",
  "-marionette",
  "-start-debugger-server",
];

export function devtoolsOpen(cmdline: readonly string[]): boolean {
  return cmdline.some((arg) => DEVTOOLS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

/** Whether a secret for `site` may be typed into the field now focused. */
export function checkField(info: FieldInfo, want: "password" | "code", site: string): Verdict {
  if (info.cmdline === null) return { ok: false, reason: "Dashi can't tell how that browser was started." };
  if (devtoolsOpen(info.cmdline)) {
    return { ok: false, reason: "That browser was started with remote debugging (DevTools), which would let an agent read the field: Dashi won't fill it." };
  }
  const { focused } = info;
  if (!focused)
    return { ok: false, reason: "No field has the keyboard focus there (or the app doesn't say through accessibility). Click into the field first." };
  if (want === "password" && focused.kind !== "password") {
    return { ok: false, reason: "The focused field is not a password field, so Dashi won't type a password into it." };
  }
  if (want === "code" && focused.kind === "other") return { ok: false, reason: "The focused field doesn't take text." };
  if (focused.documents.length === 0)
    return { ok: false, reason: "The focused field is not on a web page (Dashi fills logins only into pages it can check the address of)." };
  for (const url of focused.documents) {
    const host = pageHost(url);
    if (!host) return { ok: false, reason: "The page's address can't be checked (it is not https)." };
    if (!siteMatches(site, host)) return { ok: false, reason: `The page is not ${site} (it, or a frame around the field, is ${host}).` };
  }
  return { ok: true, focused };
}
