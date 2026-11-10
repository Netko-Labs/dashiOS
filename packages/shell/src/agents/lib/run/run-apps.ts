/** Apps and their windows: what is open, what is installed, and starting one (waiting for its first new window). */

import { statSync } from "node:fs";
import type { CompositorWindow } from "../../../compositor.ts";
import { type Entry, launchEntry, loadEntries } from "../../../entries.ts";
import { windowToFront } from "../../../front-window.ts";
import type { Tile } from "../../../layout.ts";
import { kindOf } from "../../../shared/files/kinds.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../../context.ts";
import { descendsFrom } from "../../peer.ts";
import type { Handlers } from "./run-types.ts";

/** How long `launch_app` waits for the app's first window. */
const LAUNCH_WAIT_MS = 10_000;

const owns = (entry: Entry, appId: string): boolean =>
  appId !== "" && [entry.id, entry.wmClass].some((id) => id !== undefined && id.toLowerCase() === appId.toLowerCase());

function describe(window: CompositorWindow, entries: readonly Entry[], arrangement: Tile | null) {
  return {
    id: `w${window.id}`,
    appId: window.appId,
    app: entries.find((entry) => owns(entry, window.appId))?.name ?? null,
    title: window.title,
    pid: window.pid,
    focused: window.focused,
    state: window.state,
    arrangement,
    fullscreen: window.fullscreen ?? false,
    frame: window.frame,
    // Agents count Spaces from 1, as people see them.
    space: (window.space ?? 0) + 1,
  };
}

async function listWindows(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at your windows");
  // Hidden entries too: they only name windows (T3 Code's window answers to a NoDisplay one).
  const entries = loadEntries({ withHidden: true });
  return json({ windows: (await ctx.compositor.windows()).map((window) => describe(window, entries, ctx.arrangement(window.id))) });
}

async function listApps(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at your apps");
  const running = (await ctx.compositor.windows()).map((window) => window.appId);
  return json({
    apps: loadEntries().map((entry) => ({ id: entry.id, name: entry.name, running: running.some((appId) => owns(entry, appId)) })),
  });
}

async function launchApp(wanted: string, ctx: RunContext): Promise<ToolResult> {
  const query = wanted.replace(/\.desktop$/, "").toLowerCase();
  const entries = loadEntries();
  const entry = entries.find((candidate) => candidate.id.toLowerCase() === query) ?? entries.find((candidate) => candidate.name.toLowerCase() === query);
  if (!entry) return toolError(`No installed app is called “${wanted}”; list_apps shows what is installed.`);
  // Already open (minimized, say): its window comes forward, as from the Dock, and no second copy starts.
  const front = windowToFront((await ctx.compositor.windows()).filter((window) => owns(entry, window.appId)));
  if (front) {
    ctx.status(`Bringing ${entry.name} forward`);
    await ctx.compositor.focus({ window: front.id });
    const shown: CompositorWindow = { ...front, focused: true, state: "normal" };
    const described = ctx.mayName() ? describe(shown, entries, ctx.arrangement(front.id)) : { id: `w${front.id}`, app: entry.name };
    return text(`${entry.name} was already open; its window is in front: ${JSON.stringify(described)}`, { window: described });
  }
  return startAndWait(entry, entries, ctx);
}

/** Preview, Dashi's viewer, opened on a file: a window of its own for each. */
async function openInPreview(path: string, ctx: RunContext): Promise<ToolResult> {
  const entries = loadEntries();
  const entry = entries.find((candidate) => candidate.id === "dev.dashi.preview" && candidate.exec);
  if (!entry?.exec) return toolError("Preview is not installed.");
  if (kindOf(path) === null) return toolError("Preview opens images (PNG, JPEG, WebP, GIF, BMP, SVG, TIFF) and PDFs; that file name is neither.");
  try {
    if (!statSync(path).isFile()) return toolError("That path is not a file.");
  } catch {
    return toolError("There is no file at that path, or Dashi cannot read it.");
  }
  return startAndWait({ ...entry, exec: [...entry.exec, path] }, entries, ctx);
}

/** Start `entry`, and return its first new window (waiting up to LAUNCH_WAIT_MS). */
async function startAndWait(entry: Entry, entries: readonly Entry[], ctx: RunContext): Promise<ToolResult> {
  ctx.status(`Opening ${entry.name}`);
  // Listen before starting it, so its window can't slip by.
  let pid: number | null = null;
  let stop = () => {};
  const opened = new Promise<CompositorWindow | null>((resolve) => {
    const timer = setTimeout(() => {
      stop();
      resolve(null);
    }, LAUNCH_WAIT_MS);
    const off = ctx.compositor.on((event) => {
      if (event.event !== "window-opened") return;
      const window = event.window;
      const ours = (pid !== null && window.pid !== null && descendsFrom(window.pid, pid)) || owns(entry, window.appId);
      if (!ours) return;
      stop();
      resolve(window);
    });
    stop = () => {
      clearTimeout(timer);
      off();
    };
  });
  pid = launchEntry(entry);
  if (pid === null) {
    stop();
    return toolError(`${entry.name} could not start.`);
  }
  const window = await opened;
  if (!window) {
    return text(
      `${entry.name} started, but no new window appeared within ${LAUNCH_WAIT_MS / 1000} seconds; it may have opened in an instance that was already running. Call list_windows.`,
    );
  }
  // Without "see", the new window is only an id and the app the agent asked for.
  const described = ctx.mayName() ? describe(window, entries, null) : { id: `w${window.id}`, app: entry.name };
  return text(`${entry.name} is open: ${JSON.stringify(described)}`, { window: described });
}

export const appHandlers = {
  list_windows: (_call, ctx) => listWindows(ctx),
  list_apps: (_call, ctx) => listApps(ctx),
  launch_app: (call, ctx) => launchApp(call.app, ctx),
  open_in_preview: (call, ctx) => openInPreview(call.path, ctx),
} satisfies Handlers<"list_windows" | "list_apps" | "launch_app" | "open_in_preview">;
