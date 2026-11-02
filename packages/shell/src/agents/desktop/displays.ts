/** The screens, through the compositor's `outputs` and `output` (displays.ts has the rules). */

import { type ApplyResult } from "../../display-config/manager.ts";
import { type Monitor, parseMonitors, refreshLabel, type Rotation } from "../../display-config/monitors.ts";
import { isBuiltIn, leavesRoom, parseScreens, type ScreenInfo, scalesFor } from "../../displays.ts";
import { json, type RunContext, text, toolError, type ToolResult } from "../context.ts";

const screens = async (ctx: RunContext): Promise<ScreenInfo[]> => parseScreens(await ctx.compositor.request("outputs"));

/** "2560x1440@59.95": a mode as list_displays writes it. */
const modeText = (mode: { width: number; height: number; refreshMhz: number }): string =>
  `${mode.width}x${mode.height}@${refreshLabel(mode.refreshMhz).replace(" Hz", "")}`;

/** What only the compositor with the arrangement service says about a screen; nothing for one that does not. */
function describeMonitor(monitor: Monitor | undefined) {
  if (!monitor) return {};
  return {
    ...(monitor.make !== "" ? { make: monitor.make, model: monitor.model } : {}),
    ...(monitor.primary ? { primary: true } : {}),
    ...(monitor.rotation !== 0 ? { rotation: monitor.rotation } : {}),
    ...(monitor.modes.length > 0 && monitor.mode ? { refreshHz: Math.round(monitor.mode.refreshMhz / 10) / 100, modes: monitor.modes.map(modeText) } : {}),
  };
}

function describeScreen(screen: ScreenInfo, monitor?: Monitor) {
  return {
    name: screen.name,
    builtIn: isBuiltIn(screen.name),
    scale: screen.scale,
    /** Points: where it sits in the screen space and how big it is. */
    frame: screen.frame ?? null,
    pixels: { width: screen.width, height: screen.height },
    sizeMm: screen.widthMm > 0 && screen.heightMm > 0 ? { width: screen.widthMm, height: screen.heightMm } : null,
    scales: scalesFor(screen),
    ...describeMonitor(monitor),
  };
}

export async function listDisplays(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at your screens");
  const answer = await ctx.compositor.request("outputs");
  const monitors = parseMonitors(answer);
  const off = monitors
    .filter((monitor) => !monitor.enabled)
    .map((monitor) => ({ name: monitor.name, enabled: false, builtIn: monitor.builtIn, ...describeMonitor(monitor) }));
  const displays = parseScreens(answer).map((screen) =>
    describeScreen(
      screen,
      monitors.find((monitor) => monitor.name === screen.name),
    ),
  );
  return json({ displays: [...displays, ...off] });
}

export async function setDisplayScale(name: string, scale: number, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Changing a screen's scale");
  const screen = (await screens(ctx)).find((candidate) => candidate.name === name);
  if (!screen) return toolError(`There is no screen called “${name}”; list_displays shows the names.`);
  if (!leavesRoom(screen, scale)) {
    const size = `${Math.round(screen.width / scale)}×${Math.round(screen.height / scale)}`;
    return toolError(`Scale ${scale} would leave ${screen.name} only ${size} points, too small to use. It can take: ${scalesFor(screen).join(", ")}.`);
  }
  // The name is the compositor's now, not the agent's string.
  ctx.status(`Setting ${screen.name} to scale ${scale}`);
  await ctx.compositor.request("output", { name: screen.name, scale });
  // Settings keeps the scale a person chose; one an agent set is kept the same way, or the next start would undo it.
  try {
    ctx.desktop.rememberScale(screen.name, scale);
  } catch (error) {
    console.error("dashi-shell: could not save the screen's scale:", error instanceof Error ? error.message : error);
  }
  return text(`${screen.name} is at scale ${scale} now.`, { name: screen.name, scale });
}

const MISSING = "Display arrangement is not available here.";

/** What happened to a change that was put to the person: kept, or gone back. */
function outcome(result: ApplyResult, done: string): ToolResult {
  if (result.error !== undefined) return toolError(result.error);
  return result.kept
    ? text(`${done} The person kept it.`, { kept: true })
    : text("The person did not keep it (or did not answer in time), so the screen went back to how it was.", { kept: false, reverted: result.reverted });
}

/** The compositor's own name for the screen, or why there is none. */
async function named(name: string, ctx: RunContext): Promise<Monitor | ToolResult> {
  const monitor = parseMonitors(await ctx.compositor.request("outputs")).find((candidate) => candidate.name === name);
  return monitor ?? toolError(`There is no screen called “${name}”; list_displays shows the names.`);
}

const isMonitor = (value: Monitor | ToolResult): value is Monitor => "name" in value;

export async function setDisplayMode(name: string, mode: { width: number; height: number; refreshMhz?: number }, ctx: RunContext): Promise<ToolResult> {
  const displays = ctx.desktop.displays;
  if (!displays) return toolError(MISSING);
  const monitor = await named(name, ctx);
  if (!isMonitor(monitor)) return monitor;
  ctx.status(`Changing the resolution of ${monitor.name}; waiting for the person to keep it`);
  const result = await displays.setMode(monitor.name, mode);
  return outcome(result, `${monitor.name} runs ${mode.width}x${mode.height} now.`);
}

export async function setDisplayRotation(name: string, rotation: Rotation, ctx: RunContext): Promise<ToolResult> {
  const displays = ctx.desktop.displays;
  if (!displays) return toolError(MISSING);
  const monitor = await named(name, ctx);
  if (!isMonitor(monitor)) return monitor;
  ctx.status(`Rotating ${monitor.name}; waiting for the person to keep it`);
  const result = await displays.setRotation(monitor.name, rotation);
  return outcome(result, `${monitor.name} is rotated ${rotation} degrees now.`);
}

export async function setPrimaryDisplay(name: string, ctx: RunContext): Promise<ToolResult> {
  const displays = ctx.desktop.displays;
  if (!displays) return toolError(MISSING);
  const monitor = await named(name, ctx);
  if (!isMonitor(monitor)) return monitor;
  ctx.status(`Making ${monitor.name} the main display`);
  const result = await displays.setPrimary(monitor.name);
  return result.error !== undefined ? toolError(result.error) : text(`${monitor.name} is the main display now.`, { name: monitor.name });
}

export async function arrangeDisplay(name: string, x: number, y: number, ctx: RunContext): Promise<ToolResult> {
  const displays = ctx.desktop.displays;
  if (!displays) return toolError(MISSING);
  const monitor = await named(name, ctx);
  if (!isMonitor(monitor)) return monitor;
  ctx.status(`Moving ${monitor.name} in the arrangement`);
  const result = await displays.arrange({ [monitor.name]: { x, y } });
  if (result.error !== undefined) return toolError(result.error);
  const landed = parseMonitors(await ctx.compositor.request("outputs")).find((candidate) => candidate.name === monitor.name)?.frame;
  return text(
    landed ? `${monitor.name} is at ${landed.x}, ${landed.y} now.` : `${monitor.name} was moved.`,
    landed ? { name: monitor.name, x: landed.x, y: landed.y } : { name: monitor.name },
  );
}
