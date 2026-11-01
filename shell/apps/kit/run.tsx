/**
 * Starting a first-party app: one process per app (`bun apps/<name>/main.tsx
 * [host]`), one Metal host per window. `runApp` finds the host the way the
 * shell does, opens the window with the app's id (the Dock and the menu bar
 * name and draw it from that id, src/first-party.ts), follows Dark Mode, and
 * exits the process when the window goes.
 */

import { existsSync } from "node:fs";
import { type NativeHostTransport, type NativeRoot, render, spawnNativeHost, type TitleBarStyle } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { METAL_HOST } from "../../src/apps.ts";
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
}

export interface RunningApp {
  host: NativeHostTransport;
  root: NativeRoot;
  /** Closes the window; the process exits. */
  quit(): void;
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
  const stopFollowing = followDarkMode();
  const size = sizeFrom(process.env.MIRIN_METAL_SIZE, options.size);
  const titleBar: TitleBarStyle = process.env.MIRIN_METAL_TITLEBAR === "standard" ? "standard" : (options.titleBar ?? "unified");
  const host = spawnNativeHost(binary, { title: options.title, appId: options.id, width: size.width, height: size.height, titleBar });
  const root = render(element, host);
  const stopControl = serveControl(host, root);
  let open = true;
  const finish = (): void => {
    if (!open) return;
    open = false;
    root.unmount();
    stopFollowing();
    stopControl();
    process.exit(0);
  };
  host.onClose(finish);
  return {
    host,
    root,
    quit() {
      host.close();
      finish();
    },
  };
}
