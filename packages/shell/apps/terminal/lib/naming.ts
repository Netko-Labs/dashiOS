/**
 * What a tab is called. With the shell integration (integration/), a tab
 * is named by its folder ("dashiOS", "~") at the prompt and by its command
 * while one runs ("cargo build"); a program that names itself while it runs
 * (vim, ssh's remote shell: OSC 0/2) keeps its own name. Without it, the
 * name a program set, else "Terminal". Pure; the view keeps what it hears.
 */

export interface Naming {
  /** What the program last set (OSC 0/2); "" when nothing has. */
  title: string;
  /** The shell's folder (OSC 7), once it has said it. */
  folder?: { path: string; host: string };
  /** The command running in front of the shell; null at the prompt or without the integration. */
  command: string | null;
  /** The program set `title` while `command` runs: its own name for itself wins. */
  titledByCommand: boolean;
}

export const UNNAMED: Naming = { title: "", command: null, titledByCommand: false };

/** How long a command's name can be before it is cut (it shares a tab's width). */
const COMMAND_CHARS = 40;

/** A folder's last part, "~" for home and "/" for the root. */
export function folderName(path: string, home: string | undefined): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (home && trimmed === home.replace(/\/+$/, "")) return "~";
  if (trimmed === "/" || trimmed === "") return "/";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** A command line as a tab says it: on one line, cut when long. */
export function commandName(command: string): string {
  const line = command.replace(/\s+/g, " ").trim();
  return line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 1)}…` : line;
}

export function tabName(naming: Naming, home: string | undefined): string {
  if (naming.command !== null) {
    if (naming.titledByCommand && naming.title) return naming.title;
    const command = commandName(naming.command);
    if (command) return command;
  }
  if (naming.folder) return folderName(naming.folder.path, home);
  return naming.title || "Terminal";
}

/**
 * Where a new tab or window opens: the front tab's folder when it is on this
 * machine (a shell over ssh may name a folder on another), else none.
 */
export function localFolder(folder: Naming["folder"], hostname: string): string | null {
  if (!folder) return null;
  const host = folder.host.toLowerCase();
  const here = hostname.toLowerCase();
  const local = host === "" || host === "localhost" || host === here || host === here.split(".")[0];
  return local ? folder.path : null;
}

/** The naming after a message from the engine; the same object when it doesn't change. */
export function renamed(
  naming: Naming,
  message: { t: "title"; title: string } | { t: "cwd"; path: string; host: string } | { t: "prompt" } | { t: "command"; command: string },
): Naming {
  switch (message.t) {
    case "title":
      return naming.title === message.title ? naming : { ...naming, title: message.title, titledByCommand: naming.command !== null };
    case "cwd":
      return naming.folder?.path === message.path && naming.folder.host === message.host
        ? naming
        : { ...naming, folder: { path: message.path, host: message.host } };
    case "prompt":
      return naming.command === null ? naming : { ...naming, command: null, titledByCommand: false };
    case "command":
      return { ...naming, command: message.command, titledByCommand: false };
  }
}
