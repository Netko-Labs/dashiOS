/**
 * Terminal (dev.dashi.terminal): `bun apps/terminal/main.tsx [host] [-- COMMAND...]`
 * (after `--`, what the first tab runs in place of the shell: an app whose
 * desktop entry says `Terminal=true`, src/entries.ts). The
 * terminal itself is dashi-term (crates/dashi-term, on Ghostty's
 * libghostty-vt); this process draws it (view.tsx) and talks to it
 * (engine.ts). Without dashi-term the window opens and says so.
 */

import { hostBinary, runApp, systemClipboard } from "../kit/index.ts";
import { engineBinary, splitCommand } from "./engine.ts";
import { TERMINAL_SIZE, TerminalWindow } from "./view.tsx";

/** A window opened from another starts its first shell where that one's front tab is. */
const FOLDER_VAR = "DASHI_TERMINAL_FOLDER";

const binary = engineBinary();
if (!binary) console.error("dev.dashi.terminal: dashi-term is not installed (the dashi-term package, or build crates/dashi-term)");
const firstFolder = process.env[FOLDER_VAR] || null;
delete process.env[FOLDER_VAR];
const { own, command } = splitCommand(Bun.argv.slice(2));

/** Another Terminal window: another process, as Dashi's apps are one per window. */
function newWindow(folder: string | null): void {
  const env = { ...process.env, ...(folder ? { [FOLDER_VAR]: folder } : {}) };
  // Its own arguments only: a command runs in the window it was opened with, not in the next.
  const child = Bun.spawn([process.execPath, Bun.argv[1] as string, ...own], { stdio: ["ignore", "ignore", "inherit"], cwd: process.env.HOME, env });
  child.unref();
}

let quit = (): void => process.exit(0);
let setTitle = (_title: string): void => {};
/** Stable across renders, so the view retitles only when the title changes. */
const retitle = (title: string): void => setTitle(title);
// The unified title bar: one row for the title, or the tabs once there are two (VS-1, VS-4).
const app = runApp(
  // The host is named before `--`: a command's own words (a path) are never taken for it.
  { id: "dev.dashi.terminal", title: "Terminal", size: TERMINAL_SIZE, host: hostBinary(own) },
  <TerminalWindow
    binary={binary}
    onExit={() => quit()}
    newWindow={newWindow}
    setTitle={retitle}
    clipboard={systemClipboard()}
    firstFolder={firstFolder}
    firstCommand={command}
  />,
);
quit = app.quit;
setTitle = (title) => app.host.setTitle(title);
