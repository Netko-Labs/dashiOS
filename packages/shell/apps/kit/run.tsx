/**
 * Starting a first-party app: one process per app (`bun apps/<name>/main.tsx
 * [host]`), one Metal host per window. `runApp` finds the host the way the
 * shell does, opens the window with the app's id (the Dock and the menu bar
 * name and draw it from that id, src/first-party.ts), follows Dark Mode, and
 * exits the process when the window goes: with `closeCode` when the person
 * closes it, with the code given to `quit` when the app does.
 */

import { existsSync } from "node:fs";
import { TextSelectionLook } from "@dashi/ui";
import { type NativeHostTransport, type NativeRoot, render, spawnNativeHost, type TitleBarStyle } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { METAL_HOST } from "../../src/apps.ts";
import { connectDarkMode } from "../../src/control-center/dark-mode.ts";
import { appNameEnv } from "../../src/metal-host.ts";
import { followDarkMode } from "./appearance.ts";
import { serveControl } from "./control.ts";
import { setProcessName } from "./name.ts";

export interface Size {
  width: number;
  height: number;
}

export interface AppOptions {
  /** `dev.dashi.<name>`: the window's app id, as listed in src/first-party.ts. */
  id: string;
  title: string;
  size: Size;
  /**
   * `unified` (the default) runs the content to the top edge with the
   * compositor's window controls over it, where the compositor can (Dashi's);
   * elsewhere, and with `standard`, the window has an ordinary title bar.
   * `MIRIN_METAL_TITLEBAR=standard` forces the ordinary one.
   */
  titleBar?: TitleBarStyle;
  /** The Metal host, for an app whose command line is not only a host path (Preview takes files). */
  host?: string;
  /** The exit status when the window is closed or the process is told to stop; 0 by default (a dialog's close is a Cancel, 1). */
  closeCode?: number;
}

export interface RunningApp {
  host: NativeHostTransport;
  root: NativeRoot;
  /** Closes the window; the process exits, with `code` (0 by default). */
  quit(code?: number): void;
}

/**
 * The Metal host: `--host <path>` on the command line, else a path given there
 * (an app that takes no files), else the shell's (`DASHI_METAL_HOST`, else the
 * sibling mirin build). An app that takes files uses `--host`, since a file is a path too.
 */
export function hostBinary(argv: readonly string[] = Bun.argv.slice(2)): string {
  const flag = argv.indexOf("--host");
  const named = flag >= 0 ? argv[flag + 1] : undefined;
  if (named) return named;
  return argv.find((arg) => arg.includes("/")) ?? METAL_HOST;
}

/** `MIRIN_METAL_SIZE=WxH` overrides the app's size (checks open windows at a size of their choosing). */
function sizeFrom(env: string | undefined, fallback: Size): Size {
  const match = env?.match(/^(\d+)x(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : fallback;
}

export function runApp(options: AppOptions, element: ReactElement): RunningApp {
  const binary = options.host ?? hostBinary();
  if (!existsSync(binary)) {
    console.error(`${options.id}: no Metal host at ${binary}; build mirin's crates/mirin-metal (cargo build --release) or set DASHI_METAL_HOST`);
    process.exit(1);
  }
  setProcessName(options.title);
  connectDarkMode();
  const stopFollowing = followDarkMode();
  const size = sizeFrom(process.env.MIRIN_METAL_SIZE, options.size);
  const titleBar: TitleBarStyle = process.env.MIRIN_METAL_TITLEBAR === "standard" ? "standard" : (options.titleBar ?? "unified");
  // The app's name for screen readers, whatever the window is titled later.
  const env = appNameEnv(options.title);
  const host = spawnNativeHost(binary, { title: options.title, appId: options.id, width: size.width, height: size.height, titleBar, env });
  const root = render(<TextSelectionLook>{element}</TextSelectionLook>, host);
  const stopControl = serveControl(host, root);
  let open = true;
  const closeCode = options.closeCode ?? 0;
  const finish = (code: number): void => {
    if (!open) return;
    open = false;
    root.unmount();
    stopFollowing();
    stopControl();
    process.exit(code);
  };
  host.onClose(() => finish(closeCode));
  // Told to stop (kill, logout): the window goes with the process. The Metal
  // host is a process of its own and would otherwise stay on screen.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      host.close();
      finish(closeCode);
    });
  }
  return {
    host,
    root,
    quit(code = 0) {
      host.close();
      finish(code);
    },
  };
}
