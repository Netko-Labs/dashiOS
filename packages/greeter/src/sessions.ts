/**
 * What can be started: the Wayland sessions installed in
 * /usr/share/wayland-sessions (and $XDG_DATA_DIRS), as their desktop entries
 * describe them. Dashi's comes first.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SessionCommand } from "./greetd/index.ts";

export interface Session {
  /** The entry's file name without `.desktop`: "dashi". */
  id: string;
  name: string;
  /** Exec, split into arguments. */
  cmd: string[];
  desktopNames: string[];
}

/** A desktop entry's [Desktop Entry] group as key/value pairs. */
function entryGroup(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let inGroup = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inGroup = line === "[Desktop Entry]";
      continue;
    }
    const at = line.indexOf("=");
    if (inGroup && at > 0 && !line.startsWith("#")) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return values;
}

/** Exec's arguments: split on spaces outside double quotes, field codes (%f, %U, …) dropped. */
export function splitExec(exec: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < exec.length; i++) {
    const char = exec[i] as string;
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (char === "\\" && quoted && i + 1 < exec.length) {
      current += exec[++i];
    } else if (char === " " && !quoted) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args.filter((arg) => !/^%[a-zA-Z]$/.test(arg));
}

/** A session from its desktop entry's text; null when it is hidden or has nothing to run. */
export function parseSession(id: string, text: string): Session | null {
  const entry = entryGroup(text);
  if (entry.get("Hidden") === "true" || entry.get("NoDisplay") === "true") return null;
  const cmd = splitExec(entry.get("Exec") ?? "");
  if (cmd.length === 0) return null;
  const desktopNames = (entry.get("DesktopNames") ?? "").split(";").filter(Boolean);
  return { id, name: entry.get("Name") || id, cmd, desktopNames };
}

/** Dashi's own sessions first, then the rest by name. */
export function orderSessions(sessions: Session[]): Session[] {
  const isDashi = (s: Session): boolean => s.desktopNames.includes("Dashi");
  return [...sessions].sort((a, b) => Number(isDashi(b)) - Number(isDashi(a)) || a.name.localeCompare(b.name));
}

export function loadSessions(dataDirs = process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share"): Session[] {
  const seen = new Map<string, Session>();
  for (const dir of dataDirs.split(":").map((d) => join(d, "wayland-sessions"))) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".desktop"))) {
      const id = basename(file, ".desktop");
      if (seen.has(id)) continue;
      try {
        const session = parseSession(id, readFileSync(join(dir, file), "utf8"));
        if (session) seen.set(id, session);
      } catch {
        // An unreadable entry is not a session.
      }
    }
  }
  return orderSessions([...seen.values()]);
}

/** What greetd runs for `session`: its command, in a Wayland session named after its desktop. */
export function commandFor(session: Session): SessionCommand {
  const desktop = session.desktopNames[0] ?? session.name;
  return {
    cmd: session.cmd,
    env: ["XDG_SESSION_TYPE=wayland", `XDG_SESSION_DESKTOP=${desktop}`, `XDG_CURRENT_DESKTOP=${session.desktopNames.join(":") || desktop}`],
  };
}
