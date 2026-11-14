/**
 * An extension older than the one the package holds (decisions.md D117).
 * Helium takes the packaged extension when it starts (the policy's
 * `minimum_version_required`); a Helium that was open through the package's
 * update still runs the old one, and what the old one lacks fails quietly
 * (a page opened for an agent lands in the person's window). So the shell
 * says it once, with what to do. Pure but for reading the update manifest.
 */

import { readFileSync } from "node:fs";
import type { NotifyInput } from "../notifications/index.ts";
import { iconPath } from "../shared/apps/index.ts";

/** The update manifest dashi-helium installs beside the CRX. */
export const UPDATE_MANIFEST = "/usr/share/dashi/browser/updates.xml";

/** The version the package holds, from its update manifest; null without the package. */
export function packagedExtensionVersion(path = process.env.DASHI_BROWSER_UPDATES || UPDATE_MANIFEST): string | null {
  try {
    return /<updatecheck\b[^>]*\bversion=['"](\d+(?:\.\d+){0,3})['"]/.exec(readFileSync(path, "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Whether version `a` is older than `b`, number by number (0.9 is 0.9.0). */
export function olderVersion(a: string, b: string): boolean {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

export function staleExtensionNotice(running: string, packaged: string): NotifyInput {
  return {
    appName: "Agents",
    appIcon: iconPath("agents"),
    summary: "Helium needs a restart",
    body: `Helium is running an older Dashi extension (${running}). Quit Helium and open it again to get ${packaged}; until then agents may open pages in your own window.`,
    actions: [],
    urgency: "normal",
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "dashi.agent",
    transient: false,
    resident: false,
  };
}

/** Says it once for each pair of versions, however often that extension joins again. */
export function staleExtensionWatch(notify: (input: NotifyInput) => void, packaged: () => string | null = packagedExtensionVersion): (version: string) => void {
  const said = new Set<string>();
  return (running) => {
    const holds = packaged();
    if (!holds || !olderVersion(running, holds) || said.has(`${running} ${holds}`)) return;
    said.add(`${running} ${holds}`);
    console.error(`dashi-shell: the browser runs Dashi's extension ${running}; the package holds ${holds}`);
    notify(staleExtensionNotice(running, holds));
  };
}
