/**
 * The portal's dialogs on screen: each is its own Metal window (one host per
 * dialog, React through @mirinjs/metal), taken from a warm host so it opens
 * as fast as a sheet in Dashi's own apps (src/shared/metal/host.ts). When the app
 * gave its window (`wayland:` or `x11:`), the shell is told first, and the
 * window comes up with a one-off title it knows, so it is hung from that
 * window as a sheet (src/portal-host/sheets.ts); then it takes its real title.
 * With no parent it is an ordinary window, placed as any other.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { type NativeHostTransport, type NativeRoot, type NativeWindowOptions, render, spawnNativeHost } from "@mirinjs/metal";
import { createElement, type ReactElement } from "react";
import { METAL_HOST } from "../../../src/shared/apps/index.ts";
import { Surface, shellHostOptions, WarmHost, windowSurface } from "../../../src/shared/metal/index.ts";
import { PORTAL_APP_ID, parseParentWindow, sheetTitle } from "../../../src/shared/portal-host/index.ts";
import type { ShellLink } from "./shell.ts";

/** How long a sheet keeps its one-off title: the shell has placed it by then. */
const RETITLE_MS = 1500;

export interface DialogWindow {
  /** The app's window (`wayland:…`, `x11:…`, or "" for none). */
  parent: string;
  title: string;
  width: number;
  height: number;
  /** The least the person may make it: its toolbar's one row still fits (the file chooser's). */
  least?: { width: number; height: number };
}

/** Shows a dialog until it answers, its window is closed, or `signal` aborts (the app gave up); `closed` is the answer then. */
export type ShowDialog = <T>(window: DialogWindow, build: (answer: (value: T) => void) => ReactElement, signal: AbortSignal, closed: T) => Promise<T>;

export function dialogWindows(shell: ShellLink, binary: string = METAL_HOST): ShowDialog {
  // Warm from the start: the first dialog of the session opens as fast as the rest.
  const warm = existsSync(binary) ? new WarmHost(binary) : null;
  const host = (window: NativeWindowOptions & { title: string; appId: string; width: number; height: number }): NativeHostTransport => {
    if (!existsSync(binary)) throw new Error(`no Metal host at ${binary}`);
    const { title, appId, width, height } = window;
    return warm?.take(window) ?? spawnNativeHost(binary, shellHostOptions({ title, appId, width, height, titleBar: "unified" }));
  };
  return async (window, build, signal, closed) => {
    if (signal.aborted) return closed;
    const parent = parseParentWindow(window.parent);
    const token = `p${randomBytes(6).toString("hex")}`;
    const sheet = parent !== null && (await shell.expectSheet(sheetTitle(token), parent));
    // The app may have given up while the shell was asked; its abort has fired already.
    if (signal.aborted) return closed;
    const transport = host({
      appId: PORTAL_APP_ID,
      title: sheet ? sheetTitle(token) : window.title,
      width: window.width,
      height: window.height,
      titleBar: "unified",
    });
    if (window.least) transport.setMinSize(window.least.width, window.least.height);
    return new Promise((resolve) => {
      let done = false;
      let retitle: ReturnType<typeof setTimeout> | null = null;
      const finish = (value: typeof closed) => {
        if (done) return;
        done = true;
        if (retitle) clearTimeout(retitle);
        signal.removeEventListener("abort", onAbort);
        root.unmount();
        transport.close();
        resolve(value);
      };
      const onAbort = () => finish(closed);
      // The chooser's listing asks its window where its items are (a marquee, src/shared/metal/surface.ts).
      const mounted: { root: NativeRoot | null } = { root: null };
      const surface = windowSurface(transport, () => mounted.root);
      const root = render(createElement(Surface.Provider, { value: surface }, build(finish)), transport);
      mounted.root = root;
      transport.onClose(() => finish(closed));
      signal.addEventListener("abort", onAbort);
      if (sheet) retitle = setTimeout(() => transport.setTitle(window.title), RETITLE_MS);
    });
  };
}
