/**
 * Carrying out tool calls: windows and apps through the compositor's IPC,
 * everything else through the desktop's own stores (desktop/). Window ids
 * are the compositor's numbers as "w3". A screenshot waits until no consent
 * sheet is on screen; a launch waits for the app's first new window.
 */

import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { kindOf } from "../../apps/preview/kinds.ts";
import type { CompositorWindow } from "../compositor.ts";
import { type Entry, launchEntry, loadEntries } from "../entries.ts";
import { windowToFront } from "../front-window.ts";
import type { Tile } from "../layout.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "./context.ts";
import { browserCall } from "./desktop/browser.ts";
import * as desktop from "./desktop/index.ts";
import { recordScreen } from "./desktop/record.ts";
import { handOver, listLogins, payCall, signInCall } from "./desktop/secrets.ts";
import { AGENT_MASK } from "./mask.ts";
import { descendsFrom } from "./peer.ts";
import { named, noWindow, subject } from "./subject.ts";
import type { Call, Rect } from "./tools/index.ts";

/** How long `launch_app` waits for the app's first window. */
const LAUNCH_WAIT_MS = 10_000;

const owns = (entry: Entry, appId: string) =>
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

export async function runCall(call: Call, ctx: RunContext): Promise<ToolResult> {
  const { compositor } = ctx;
  switch (call.name) {
    case "list_windows": {
      ctx.status("Looking at your windows");
      // Hidden entries too: they only name windows (T3 Code's window answers to a NoDisplay one).
      const entries = loadEntries({ withHidden: true });
      return json({ windows: (await compositor.windows()).map((window) => describe(window, entries, ctx.arrangement(window.id))) });
    }
    case "list_apps": {
      ctx.status("Looking at your apps");
      const running = (await compositor.windows()).map((window) => window.appId);
      return json({
        apps: loadEntries().map((entry) => ({ id: entry.id, name: entry.name, running: running.some((appId) => owns(entry, appId)) })),
      });
    }
    case "screenshot":
      return screenshot(call.window, call.rect, ctx);
    case "record_screen":
      return recordScreen(call, ctx);
    case "launch_app":
      return launchApp(call.app, ctx);
    case "open_in_preview":
      return openInPreview(call.path, ctx);
    case "force_quit_app":
      return desktop.forceQuitApp(call.target, ctx);
    case "lock_screen":
      return desktop.lockScreen(ctx);
    case "list_spaces":
      return desktop.listSpaces(ctx);
    case "switch_space":
      return desktop.switchSpace(call.space, ctx);
    case "move_window_to_space":
      return desktop.moveWindowToSpace(call.window, call.space, ctx);
    case "list_notifications":
      return desktop.listNotifications(call.limit, ctx);
    case "dismiss_notification":
      return desktop.dismissNotification(call.id, ctx);
    case "clear_notifications":
      return desktop.clearNotifications(ctx);
    case "list_folder":
      return desktop.listFolder(call, ctx);
    case "search_files":
      return desktop.searchFiles(call, ctx);
    case "open_file":
      return desktop.openFile(call, ctx);
    case "trash_file":
      return desktop.trashFile(call, ctx);
    case "list_notes":
      return desktop.listNotes(call.folder, call.limit, ctx);
    case "search_notes":
      return desktop.searchNotesTool(call.query, call.limit, ctx);
    case "read_note":
      return desktop.readNote(call.id, ctx);
    case "create_note":
      return desktop.createNote(call, ctx);
    case "append_to_note":
      return desktop.appendToNote(call.id, call.text, ctx);
    case "list_calendars":
      return desktop.listCalendars(ctx);
    case "list_events":
      return desktop.listEvents(call, ctx);
    case "create_event":
      return desktop.createEvent(call, ctx);
    case "get_settings":
      return desktop.getSettings(ctx);
    case "set_setting":
      return desktop.setSetting(call, ctx);
    case "get_region_settings":
      return desktop.getRegionSettings(ctx);
    case "set_time_zone":
      return desktop.setTimeZone(call, ctx);
    case "set_clock_24_hour":
      return desktop.setClock24Hour(call, ctx);
    case "set_region_formats":
      return desktop.setRegionFormats(call, ctx);
    case "open_setup_assistant":
      return desktop.openSetupAssistant(call, ctx);
    case "get_network":
      return desktop.getNetwork(ctx);
    case "list_bluetooth_devices":
      return desktop.listBluetoothDevices(ctx);
    case "set_bluetooth_connection":
      return desktop.setBluetoothConnection(call, ctx);
    case "get_sound":
      return desktop.getSound(ctx);
    case "set_sound_output":
      return desktop.setSoundOutput(call, ctx);
    case "set_volume":
      return desktop.setVolume(call, ctx);
    case "get_power":
      return desktop.getPower(ctx);
    case "set_power_profile":
      return desktop.setPowerProfile(call, ctx);
    case "get_account":
      return desktop.getAccount(ctx);
    case "list_displays":
      return desktop.listDisplays(ctx);
    case "set_display_scale":
      return desktop.setDisplayScale(call.display, call.scale, ctx);
    case "set_display_mode":
      return desktop.setDisplayMode(
        call.display,
        { width: call.width, height: call.height, ...(call.refreshMhz !== undefined ? { refreshMhz: call.refreshMhz } : {}) },
        ctx,
      );
    case "set_display_rotation":
      return desktop.setDisplayRotation(call.display, call.rotation, ctx);
    case "set_primary_display":
      return desktop.setPrimaryDisplay(call.display, ctx);
    case "arrange_display":
      return desktop.arrangeDisplay(call.display, call.x, call.y, ctx);
    case "list_wifi_networks":
      return desktop.listWifi(ctx);
    case "join_wifi":
      return desktop.joinWifi(call.ssid, ctx);
    case "list_menus":
      return desktop.listMenus(call.window, ctx);
    case "choose_menu_item":
      return desktop.chooseMenuItem(call.window, call.menu, call.item, ctx);
    case "search_software":
      return desktop.searchSoftware(call, ctx);
    case "get_software":
      return desktop.getSoftware(call, ctx);
    case "list_installed_software":
      return desktop.listInstalledSoftware(ctx);
    case "list_software_updates":
      return desktop.listSoftwareUpdates(ctx);
    case "request_software_install":
      return desktop.requestInstall(call, ctx);
    case "request_software_update":
      return desktop.requestUpdate(call, ctx);
    case "list_logins":
      return listLogins(call, ctx);
    case "sign_in":
    case "fill_code":
      return signInCall(call, ctx);
    case "pay":
      return payCall(call, ctx);
    case "hand_over":
      return handOver(call, ctx);
    case "read_clipboard_history":
      return desktop.readClipboardHistory(call.limit, ctx);
    case "open_url":
    case "read_page":
    case "click_element":
    case "fill_element":
    case "select_option":
    case "press":
    case "scroll_page":
    case "list_tabs":
    case "switch_tab":
      return browserCall(call, ctx);
    case "click":
    case "scroll":
    case "drag":
    case "type_text":
    case "press_keys":
      return desktop.handsCall(call, ctx);
    default: {
      const window = await named(compositor, call.window);
      if (!window) return noWindow(call.window);
      const verb = { focus_window: "Bringing", minimize_window: "Minimizing", close_window: "Closing", tile_window: "Arranging" }[call.name];
      ctx.status(`${verb} ${subject(window, ctx)}`);
      if (call.name === "tile_window") {
        await ctx.tile(window.id, call.tile);
      } else {
        const method = { focus_window: "focus", minimize_window: "minimize", close_window: "close" }[call.name];
        await compositor.request(method, { window: window.id });
      }
      const done = {
        focus_window: "is in front and focused",
        minimize_window: "is minimized",
        close_window: "was asked to close (the app may ask the person to save first)",
        tile_window: "is arranged",
      }[call.name];
      return text(`w${window.id}${ctx.mayName() ? ` (“${window.title}”)` : ""} ${done}.`);
    }
  }
}

async function screenshot(id: number | null, rect: Rect | undefined, ctx: RunContext): Promise<ToolResult> {
  if (id !== null) {
    const window = await named(ctx.compositor, id);
    if (!window) return noWindow(id);
    ctx.status(`Looking at ${subject(window, ctx)}`);
  } else {
    ctx.status(rect ? "Looking at part of the screen" : "Taking a screenshot");
  }
  // Never in an agent's picture, blanked (mask.ts): consent sheets (so a screenshot needn't wait for
  // the person to answer one), password fields, the vault, a window handed to the person.
  try {
    await ctx.mask.update();
  } catch {
    return toolError("The screenshot was not taken: Dashi couldn't blank what agents must not see.");
  }
  const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "dashi-agents");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${crypto.randomUUID()}.png`);
  try {
    const answer = (await ctx.compositor.request("capture", {
      path,
      mask: AGENT_MASK,
      ...(id !== null ? { window: id } : {}),
      ...(rect ? { rect } : {}),
    })) as Record<string, unknown>;
    const data = Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
    const scale = Number(answer.scale) || 1;
    return {
      content: [
        { type: "image", data, mimeType: "image/png" },
        { type: "text", text: `${answer.width}×${answer.height} pixels at scale ${scale}: divide pixel positions by ${scale} for points.` },
      ],
    };
  } finally {
    rmSync(path, { force: true });
  }
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
    await ctx.compositor.request("focus", { window: front.id });
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
