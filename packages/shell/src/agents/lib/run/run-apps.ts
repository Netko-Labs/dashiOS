/** Apps and their windows: what is open, what is installed, and starting one (waiting for its first new window). */

import { statSync } from "node:fs";
import type { CompositorWindow } from "../../../compositor/index.ts";
import { launchEntry, loadEntries } from "../../../entries.ts";
import { windowToFront } from "../../../front-window.ts";
import type { Tile } from "../../../layout.ts";
import type { Entry } from "../../../shared/app-entries/index.ts";
import { kindOf } from "../../../shared/files/index.ts";
import { spaceLabel } from "../../../spaces/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../../context.ts";
import type { Opening } from "../../desktop/index.ts";
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
    // Where it waits, on a Space that does not show.
    frame: window.frame ?? window.away ?? null,
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
  const open = (await ctx.compositor.windows()).filter((window) => owns(entry, window.appId));
  // At work on another Desktop: its window there comes to the front there; one elsewhere stays where the person has it.
  const away = alreadyOpenElsewhere(entry, entries, open, ctx);
  if (away) return away;
  // Already open (minimized, say): its window comes forward, as from the Dock, and no second copy starts.
  const front = windowToFront(open);
  if (front) {
    ctx.status(`Bringing ${entry.name} forward`);
    await ctx.compositor.focus({ window: front.id });
    const shown: CompositorWindow = { ...front, focused: true, state: "normal" };
    const described = ctx.mayName() ? describe(shown, entries, ctx.arrangement(front.id)) : { id: `w${front.id}`, app: entry.name };
    return text(`${entry.name} was already open; its window is in front: ${JSON.stringify(described)}`, { window: described });
  }
  return startAndWait(entry, entries, ctx);
}

/**
 * `launch_app` from an agent at work on a Space that does not show, for an app that is open:
 * its window there is raised there (the view stays), and one on another Space is left alone,
 * the result saying so. Null when neither applies, and the launch goes on as ever.
 */
function alreadyOpenElsewhere(entry: Entry, entries: readonly Entry[], open: readonly CompositorWindow[], ctx: RunContext): Promise<ToolResult> | ToolResult | null {
  const space = ctx.elsewhere.away;
  if (space === null) return null;
  const say = (window: CompositorWindow) => (ctx.mayName() ? describe(window, entries, ctx.arrangement(window.id)) : { id: `w${window.id}`, app: entry.name });
  const there = windowToFront(open.filter((window) => (window.space ?? 0) === space));
  if (there) {
    ctx.status(`Bringing ${entry.name} forward on ${ctx.elsewhere.label}`);
    return ctx.compositor.focus({ window: there.id, stay: true }).then(() => {
      const described = say({ ...there, state: "normal" });
      return text(`${entry.name} was already open on ${ctx.elsewhere.label}; its window is in front there: ${JSON.stringify(described)}`, { window: described });
    });
  }
  const other = windowToFront(open);
  if (!other) return null;
  const described = say(other);
  return text(
    `${entry.name} is already open on ${spaceLabel(other.space ?? 0)}, not on ${ctx.elsewhere.label} where you work, and was left there: the person may be using it. ` +
      `If they want it with you, move_window_to_space puts w${other.id} on Space ${space + 1}. ${JSON.stringify(described)}`,
    { window: described, left: true },
  );
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
  ctx.status(ctx.elsewhere.away === null ? `Opening ${entry.name}` : `Opening ${entry.name} on ${ctx.elsewhere.label}`);
  // At work on another Desktop: its window opens there (desktop/elsewhere.ts), by its process or its app.
  const opening: Opening = { pid: null, owns: (appId) => owns(entry, appId) };
  const release = ctx.elsewhere.claim(opening);
  try {
    return await started(entry, entries, opening, ctx);
  } finally {
    release();
  }
}

async function started(entry: Entry, entries: readonly Entry[], opening: Opening, ctx: RunContext): Promise<ToolResult> {
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
  opening.pid = pid;
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
  // Opened on a Space that does not show (an agent at work there): say so, since nothing came on screen.
  const where = ctx.elsewhere.away !== null && (window.space ?? 0) === ctx.elsewhere.away ? ` on ${ctx.elsewhere.label}, and the person's screen did not change` : "";
  return text(`${entry.name} is open${where}: ${JSON.stringify(described)}`, { window: described });
}

export const appHandlers = {
  list_windows: (_call, ctx) => listWindows(ctx),
  list_apps: (_call, ctx) => listApps(ctx),
  launch_app: (call, ctx) => launchApp(call.app, ctx),
  open_in_preview: (call, ctx) => openInPreview(call.path, ctx),
} satisfies Handlers<"list_windows" | "list_apps" | "launch_app" | "open_in_preview">;
