/**
 * Terminal (dev.dashi.terminal): `bun apps/terminal/main.tsx [host]`. The
 * terminal itself is dashi-term (crates/dashi-term, on Ghostty's
 * libghostty-vt); this process draws it (view.tsx) and talks to it
 * (engine.ts).
 */

import { runApp, systemClipboard } from "../kit/index.ts";
import { engineBinary } from "./engine.ts";
import { TERMINAL_SIZE, TerminalWindow } from "./view.tsx";

const binary = engineBinary();
if (!binary) {
  console.error("dev.dashi.terminal: dashi-term is not installed (the dashi-term package, or build crates/dashi-term)");
  process.exit(1);
}

/** Another Terminal window: another process, as Dashi's apps are one per window. */
function newWindow(): void {
  const child = Bun.spawn([process.execPath, ...process.argv.slice(1)], { stdio: ["ignore", "ignore", "inherit"], cwd: process.env.HOME });
  child.unref();
}

let quit = (): void => process.exit(0);
let setTitle = (_title: string): void => {};
/** Stable across renders, so the view retitles only when the title changes. */
const retitle = (title: string): void => setTitle(title);
// The standard title bar: one slim line the compositor draws, like a
// terminal's anywhere else; the window has no toolbar to put in it.
const app = runApp(
  { id: "dev.dashi.terminal", title: "Terminal", size: TERMINAL_SIZE, titleBar: "standard" },
  <TerminalWindow binary={binary} onExit={() => quit()} newWindow={newWindow} setTitle={retitle} clipboard={systemClipboard()} />,
);
quit = app.quit;
setTitle = (title) => app.host.setTitle(title);
