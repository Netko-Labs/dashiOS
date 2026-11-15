/**
 * Dashi's own five profiles (docs/voice.md, "Vocabulary and profiles") and
 * how one is chosen with no setup: by the field's role (a terminal), then
 * the site of the page in front, then the app, else Writing. A file in
 * `~/.config/dashi/dictation/profiles/` changes one (lexicon.ts).
 */

import type { FieldRead, Front, Pair, Profile } from "../types.ts";

/** Apps that are terminals, by a part of their app id: Return there runs a command. */
export const TERMINALS: readonly string[] = [
  "dev.dashi.terminal",
  "ptyxis",
  "kitty",
  "alacritty",
  "foot",
  "ghostty",
  "wezterm",
  "konsole",
  "gnome-terminal",
  "org.gnome.console",
  "xterm",
  "tilix",
  "terminator",
];

const base = () => ({ polish: false, tidy: true, capitals: true, code: false, greeting: false, words: [] as string[], replacements: [] as Pair[] });

export const PROFILES: readonly Profile[] = [
  {
    ...base(),
    id: "developer",
    name: "Developer",
    apps: [...TERMINALS, "code", "codium", "cursor", "windsurf", "zed", "jetbrains", "sublime", "neovide", "t3code", "t3-code", "t3 code"],
    sites: ["github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "stackoverflow.com", "sr.ht"],
    tone: "Technical and plain. Keep identifiers, commands and file names exactly as said.",
    period: "keep",
    breaks: "soft",
    lists: "markdown",
    code: true,
    words: [
      "git",
      "GitHub",
      "npm",
      "Bun",
      "TypeScript",
      "JavaScript",
      "Rust",
      "cargo",
      "JSON",
      "API",
      "CLI",
      "sudo",
      "regex",
      "localhost",
      "stdout",
      "kubectl",
      "Docker",
      "Postgres",
      "SQLite",
      "Wayland",
      "systemd",
      "README",
      "Codex",
      "T3 Code",
    ],
  },
  {
    ...base(),
    id: "writing",
    name: "Writing",
    apps: ["dev.dashi.editor", "dev.dashi.notes", "texteditor", "gedit", "libreoffice", "writer", "obsidian"],
    sites: ["docs.google.com", "notion.so"],
    tone: "Clear written sentences.",
    period: "keep",
    breaks: "hard",
    lists: "plain",
  },
  {
    ...base(),
    id: "chat",
    name: "Chat",
    apps: ["discord", "vesktop", "slack", "telegram", "signal", "element", "fractal", "whatsapp"],
    sites: [
      "web.whatsapp.com",
      "discord.com",
      "slack.com",
      "web.telegram.org",
      "messenger.com",
      "teams.microsoft.com",
      "app.element.io",
      "claude.ai",
      "chatgpt.com",
      "gemini.google.com",
    ],
    tone: "Casual, short sentences.",
    period: "drop-single",
    breaks: "soft",
    lists: "markdown",
  },
  {
    ...base(),
    id: "email",
    name: "Email",
    apps: ["thunderbird", "geary", "evolution", "mailspring"],
    sites: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.proton.me", "app.fastmail.com", "mail.yahoo.com", "app.tuta.com"],
    tone: "Polite, complete sentences.",
    period: "keep",
    breaks: "hard",
    lists: "plain",
    greeting: true,
  },
  {
    ...base(),
    id: "verbatim",
    name: "Verbatim",
    apps: [],
    sites: [],
    tone: "",
    tidy: false,
    period: "keep",
    breaks: "hard",
    lists: "plain",
  },
];

/** What each of Dashi's own is for, as its file's first line says. */
export const PROFILE_ABOUT: Readonly<Record<string, string>> = {
  developer: "Developer: terminals, editors, agents and code hosts.",
  writing: "Writing: documents and notes. The profile for anything no other one claims.",
  chat: "Chat: messages, where Return sends.",
  email: "Email: mail apps and mail sites.",
  verbatim: "Verbatim: nothing is changed but spacing. Chosen by hand, from the capsule.",
};

const DEFAULT = "writing";

const onSite = (host: string, site: string): boolean => host === site || host.endsWith(`.${site}`);

export const isTerminalApp = (appId: string | undefined): boolean => {
  const id = (appId ?? "").toLowerCase();
  return id !== "" && TERMINALS.some((terminal) => id.includes(terminal));
};

/** Where the words go, as the profiles see it. */
export interface Place {
  profile: Profile;
  /** A shell's prompt, or an agent's: Return there runs or sends, and words are not sentences. */
  terminal: boolean;
}

/** The profile for the window and field in front, with no setup. `chosen` is the person's own pick for this window. */
export function pickProfile(profiles: readonly Profile[], front: Front | null, field: FieldRead | null, chosen?: string): Place {
  const byId = (id: string): Profile | undefined => profiles.find((profile) => profile.id === id);
  const fallback = byId(DEFAULT) ?? profiles[0] ?? PROFILES[1];
  if (!fallback) throw new Error("dictation has no profile");
  const appId = (front?.appId ?? "").toLowerCase();
  const terminal = field?.role === "terminal" || isTerminalApp(appId);
  const picked = chosen ? byId(chosen) : undefined;
  if (picked) return { profile: picked, terminal };
  if (terminal) return { profile: byId("developer") ?? fallback, terminal };
  const site = field?.site?.toLowerCase() ?? null;
  if (site) {
    const forSite = profiles.find((profile) => profile.sites.some((each) => onSite(site, each)));
    // A page nobody claims is writing, whatever the browser is.
    return { profile: forSite ?? fallback, terminal };
  }
  const forApp = appId === "" ? undefined : profiles.find((profile) => profile.apps.some((app) => appId.includes(app)));
  return { profile: forApp ?? fallback, terminal };
}

/** The profile after `id`, for a press on the capsule. */
export function nextProfile(profiles: readonly Profile[], id: string): Profile | undefined {
  const at = profiles.findIndex((profile) => profile.id === id);
  return profiles[(at + 1) % Math.max(1, profiles.length)];
}
