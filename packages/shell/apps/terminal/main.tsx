/**
 * Terminal (dev.dashi.terminal): `bun apps/terminal/main.tsx [host]`. The
 * terminal itself is dashi-term (crates/dashi-term, on Ghostty's
 * libghostty-vt); this process draws it (view.tsx) and talks to it
 * (engine.ts).
 */

import { runApp } from "../kit/index.ts";
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
const app = runApp(
  { id: "dev.dashi.terminal", title: "Terminal", size: TERMINAL_SIZE },
  <TerminalWindow binary={binary} onExit={() => quit()} newWindow={newWindow} />,
);
quit = app.quit;
